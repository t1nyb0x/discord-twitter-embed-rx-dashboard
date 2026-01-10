import { startAuditLogCleanupJob } from "./lib/audit-cleanup";
import { reconcileConfigs, reseedRedisFromSQLite } from "./lib/reseed";

/**
 * アプリケーション起動時の初期化処理
 */
export async function initializeApp(): Promise<void> {
  console.log("[Startup] Initializing Dashboard...");

  try {
    // Redis再シード処理を実行
    await reseedRedisFromSQLite();
    
    // P1: 定期リコンシルジョブを開始（10分ごと）
    startReconcileJob();
    
    // P2: 監査ログクリーンアップジョブを開始（毎日2時）
    startAuditLogCleanupJob();
    
    console.log("[Startup] Initialization completed");
  } catch (err) {
    console.error("[Startup] Initialization failed:", err);
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
      const configKeys = await import("./lib/redis").then(m => m.redis.keys("app:guild:*:config"));
      const guildIds = configKeys.map(key => key.split(":")[2]);
      
      if (guildIds.length > 0) {
        await reconcileConfigs(guildIds);
      }
    } catch (err) {
      console.error("[ReconcileJob] Error during reconcile:", err);
      // エラーが発生してもジョブは継続
    }
  }, RECONCILE_INTERVAL_MS);

  console.log(`[Startup] Reconcile job started (interval: ${RECONCILE_INTERVAL_MS / 1000}s)`);
}

// Astro開発サーバー起動時に実行
if (import.meta.env.DEV) {
  initializeApp().catch((err) => {
    console.error("[Startup] Failed to initialize:", err);
    process.exit(1);
  });
}
