import { startAuditLogCleanupJob } from "./lib/audit-cleanup";
import { createLogger } from "./lib/logger";
import { reconcileConfigs, reseedRedisFromSQLite } from "./lib/reseed";

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

    logger.info("Initialization completed");
  } catch (err) {
    logger.error("Initialization failed", { error: err instanceof Error ? err.message : String(err) });
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
      const configKeys = await import("./lib/redis").then((m) => m.redis.keys("app:guild:*:config"));
      const guildIds = configKeys.map((key) => key.split(":")[2]);

      if (guildIds.length > 0) {
        await reconcileConfigs(guildIds);
      }
    } catch (err) {
      logger.error("ReconcileJob failed", { error: err instanceof Error ? err.message : String(err) });
      // エラーが発生してもジョブは継続
    }
  }, RECONCILE_INTERVAL_MS);

  logger.info(`Reconcile job started (interval: ${RECONCILE_INTERVAL_MS / 1000}s)`);
}

// Astro開発サーバー起動時に実行
if (import.meta.env.DEV) {
  initializeApp().catch((err) => {
    logger.error("Failed to initialize", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
