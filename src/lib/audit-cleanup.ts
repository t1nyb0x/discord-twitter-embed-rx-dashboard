import { lt } from "drizzle-orm";
import { db } from "./db";
import { configAuditLogs } from "./db/schema";

/**
 * P2: 監査ログ保持期間（デフォルト90日）
 * 環境変数 AUDIT_LOG_RETENTION_DAYS で変更可能
 */
const AUDIT_LOG_RETENTION_DAYS = parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || "90", 10);

/**
 * P2: 古い監査ログをクリーンアップ
 * 保持期間を超えたログを削除
 */
export async function cleanupOldAuditLogs(): Promise<number> {
  const retentionDate = new Date();
  retentionDate.setDate(retentionDate.getDate() - AUDIT_LOG_RETENTION_DAYS);

  console.log(
    `[AuditLogCleanup] Cleaning up logs older than ${retentionDate.toISOString()} (retention: ${AUDIT_LOG_RETENTION_DAYS} days)`
  );

  try {
    const result = await db.delete(configAuditLogs).where(lt(configAuditLogs.createdAt, retentionDate.toISOString()));

    const deletedCount = result.changes || 0;

    if (deletedCount > 0) {
      console.log(`[AuditLogCleanup] Deleted ${deletedCount} old audit logs`);
    } else {
      console.log("[AuditLogCleanup] No old audit logs to delete");
    }

    return deletedCount;
  } catch (err) {
    console.error("[AuditLogCleanup] Error during cleanup:", err);
    throw err;
  }
}

/**
 * P2: 監査ログクリーンアップジョブを開始
 * 毎日1回実行（深夜2時）
 */
export function startAuditLogCleanupJob(): void {
  // 次の実行時刻を計算（深夜2時）
  const getNextRun = () => {
    const now = new Date();
    const next = new Date();
    next.setHours(2, 0, 0, 0);

    if (now >= next) {
      // 今日の2時を過ぎていたら明日の2時
      next.setDate(next.getDate() + 1);
    }

    return next.getTime() - now.getTime();
  };

  const scheduleNext = () => {
    const delay = getNextRun();
    console.log(`[AuditLogCleanup] Next cleanup scheduled in ${Math.floor(delay / 1000 / 60 / 60)} hours`);

    setTimeout(async () => {
      try {
        await cleanupOldAuditLogs();
      } catch (err) {
        console.error("[AuditLogCleanup] Job failed:", err);
      }

      // 次回の実行をスケジュール
      scheduleNext();
    }, delay);
  };

  scheduleNext();
  console.log(`[AuditLogCleanup] Cleanup job started (retention: ${AUDIT_LOG_RETENTION_DAYS} days)`);
}
