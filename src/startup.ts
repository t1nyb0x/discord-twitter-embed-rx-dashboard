import { startAuditLogCleanupJob } from "./lib/audit-cleanup";
import { createLogger } from "./lib/logger";
import { redis } from "./lib/redis";
import { reconcileConfigs, reseedRedisFromSQLite } from "./lib/reseed";

// Bot側の @twitterrx/shared と同じ値を維持すること
const DASHBOARD_VERSION_KEY = "app:dashboard:version";
const DASHBOARD_VERSION_TTL_SECONDS = 300;
const DASHBOARD_VERSION_HEARTBEAT_INTERVAL_MS = 120_000;

const logger = createLogger("Startup");

/**
 * アプリケーション起動時の初期化処理
 */
export async function initializeApp(): Promise<void> {
  logger.info("Initializing Dashboard...");

  try {
    // Redis再シード処理を実行
    await reseedRedisFromSQLite();

    // P1: 定期リコンシルジョブを開始（10分ごと）
    startReconcileJob();

    // P2: 監査ログクリーンアップジョブを開始（毎日2時）
    startAuditLogCleanupJob();

    // バージョン情報をRedisに書き込み
    await writeDashboardVersion();

    // バージョンTTL延長ハートビートを開始
    startVersionHeartbeat();

    logger.info("Initialization completed");
  } catch (err) {
    logger.error("Initialization failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * P1: 定期リコンシルジョブ
 * 10分ごとに joined なギルドの config 補完を実行
 */
function startReconcileJob(): void {
  const RECONCILE_INTERVAL_MS = 10 * 60 * 1000; // 10分

  setInterval(async () => {
    try {
      // TODO: Bot API から参加ギルドリストを取得する
      // 現時点では Redis から既存の config キーを取得して使用
      const configKeys = await import("./lib/redis").then((m) =>
        m.redis.keys("app:guild:*:config"),
      );
      const guildIds = configKeys.map((key) => key.split(":")[2]);

      if (guildIds.length > 0) {
        await reconcileConfigs(guildIds);
      }
    } catch (err) {
      logger.error("ReconcileJob failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      // エラーが発生してもジョブは継続
    }
  }, RECONCILE_INTERVAL_MS);

  logger.info(`Reconcile job started (interval: ${RECONCILE_INTERVAL_MS / 1000}s)`);
}

/**
 * ダッシュボードのバージョン情報をRedisに書き込む
 */
async function writeDashboardVersion(): Promise<void> {
  const { version } = await import("../package.json");
  await redis.set(DASHBOARD_VERSION_KEY, version, "EX", DASHBOARD_VERSION_TTL_SECONDS);
  logger.info(
    `Dashboard version ${version} written to Redis (TTL: ${DASHBOARD_VERSION_TTL_SECONDS}s)`,
  );
}

/**
 * バージョン情報のTTLを定期的に延長するハートビート
 */
function startVersionHeartbeat(): void {
  setInterval(async () => {
    try {
      await redis.expire(DASHBOARD_VERSION_KEY, DASHBOARD_VERSION_TTL_SECONDS);
    } catch (err) {
      logger.error("Version heartbeat failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, DASHBOARD_VERSION_HEARTBEAT_INTERVAL_MS);

  logger.info(
    `Version heartbeat started (interval: ${DASHBOARD_VERSION_HEARTBEAT_INTERVAL_MS / 1000}s)`,
  );
}
