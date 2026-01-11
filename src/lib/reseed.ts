import { eq } from "drizzle-orm";
import { db } from "./db";
import { guildConfigs, channelWhitelist } from "./db/schema";
import { redis } from "./redis";
import { createLogger } from "./logger";

const logger = createLogger("Reseed");

/**
 * P1: スキーマバージョン定義
 * Redis データ構造が変更された場合はこれをインクリメント
 */
const CURRENT_SCHEMA_VERSION = 1;
const SCHEMA_VERSION_KEY = "app:config:schema_version";

/**
 * P1対応: 部分キー欠落チェック
 * 各ギルドの config キーが存在するか確認
 */
async function checkForMissingConfigs(guildIds: string[]): Promise<string[]> {
  const missing: string[] = [];

  for (const guildId of guildIds) {
    const key = `app:guild:${guildId}:config`;
    const exists = await redis.exists(key);
    if (!exists) {
      missing.push(guildId);
    }
  }

  return missing;
}

/**
 * P0対応: SQLiteからRedisへの再シード処理
 * Dashboard起動時に実行される
 *
 * P1拡張: スキーマバージョンチェックと部分キー欠落検出
 */
export async function reseedRedisFromSQLite(): Promise<void> {
  logger.info("Starting SQLite→Redis reseed");

  try {
    // P1: スキーマバージョンをチェック
    const storedVersion = await redis.get(SCHEMA_VERSION_KEY);
    const needsFullReseed = !storedVersion || parseInt(storedVersion, 10) !== CURRENT_SCHEMA_VERSION;

    if (needsFullReseed) {
      logger.info("Schema version mismatch, performing full reseed", {
        storedVersion,
        currentVersion: CURRENT_SCHEMA_VERSION,
      });
      await performFullReseed();
      return;
    }

    // P1: 部分キー欠落チェック
    const allConfigs = await db.select().from(guildConfigs);
    const allGuildIds = allConfigs.map((c) => c.guildId);

    if (allGuildIds.length === 0) {
      logger.info("No configs found in SQLite");
      return;
    }

    const missingGuildIds = await checkForMissingConfigs(allGuildIds);

    if (missingGuildIds.length > 0) {
      logger.info("Found missing configs, reseeding them", { count: missingGuildIds.length });
      await reseedSpecificGuilds(missingGuildIds);
      logger.info("Partial reseed completed", { count: missingGuildIds.length });
    } else {
      logger.info("All configs are present in Redis, no reseed needed");
    }
  } catch (err) {
    logger.error("Error during reseed", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    throw err;
  }
}

/**
 * P1: 完全再シード処理
 * スキーマバージョンが変更された場合に実行
 */
async function performFullReseed(): Promise<void> {
  logger.info("Performing full reseed");

  // 既存の config キーをすべて削除
  const existingKeys = await redis.keys("app:guild:*:config");
  if (existingKeys.length > 0) {
    await redis.del(...existingKeys);
    logger.info("Deleted existing config keys", { count: existingKeys.length });
  }

  // SQLiteから全ギルド設定を取得
  const configs = await db.select().from(guildConfigs);

  if (configs.length === 0) {
    logger.info("No configs found in SQLite");
    await redis.set(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION.toString());
    return;
  }

  let reseedCount = 0;

  for (const config of configs) {
    await reseedSingleGuild(config.guildId);
    reseedCount++;
  }

  // スキーマバージョンを記録
  await redis.set(SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION.toString());

  logger.info("Full reseed completed", { count: reseedCount });
}

/**
 * P1: 特定のギルドのみ再シード
 */
async function reseedSpecificGuilds(guildIds: string[]): Promise<void> {
  for (const guildId of guildIds) {
    await reseedSingleGuild(guildId);
  }
}

/**
 * 単一ギルドの設定をRedisに保存
 */
async function reseedSingleGuild(guildId: string): Promise<void> {
  const config = await db.select().from(guildConfigs).where(eq(guildConfigs.guildId, guildId)).limit(1);

  if (config.length === 0) {
    logger.warn("Config not found for guild", { guildId });
    return;
  }

  const whitelist = await db.select().from(channelWhitelist).where(eq(channelWhitelist.guildId, guildId));

  const configData = {
    guildId: config[0].guildId,
    allowAllChannels: config[0].allowAllChannels,
    whitelist: whitelist.map((w) => w.channelId),
    version: config[0].version,
    updatedAt: config[0].updatedAt,
  };

  // Redisに保存（TTLなし = 永続）
  const key = `app:guild:${guildId}:config`;
  await redis.set(key, JSON.stringify(configData));
}

/**
 * P1: リコンシル処理（定期実行用）
 * Bot が参加しているギルドの設定が Redis に存在することを保証
 *
 * @param joinedGuildIds Bot が現在参加しているギルドIDのリスト
 */
export async function reconcileConfigs(joinedGuildIds: string[]): Promise<void> {
  logger.info("Checking joined guilds", { count: joinedGuildIds.length });

  let reconciledCount = 0;

  for (const guildId of joinedGuildIds) {
    const key = `app:guild:${guildId}:config`;
    const exists = await redis.exists(key);

    if (!exists) {
      // Redis に存在しない場合、SQLite から取得して補完
      const config = await db.select().from(guildConfigs).where(eq(guildConfigs.guildId, guildId)).limit(1);

      if (config.length > 0) {
        // 既存の設定があればそれを使用
        await reseedSingleGuild(guildId);
        logger.info("Restored config for guild", { guildId });
        reconciledCount++;
      } else {
        // 初回参加の場合、デフォルト設定を作成
        const defaultConfig = {
          guildId,
          allowAllChannels: true, // デフォルトは全チャンネル許可
          whitelist: [],
          version: 1,
          updatedAt: new Date().toISOString(),
        };

        await redis.set(key, JSON.stringify(defaultConfig));

        // SQLite にも保存（システムによる自動作成）
        await db.insert(guildConfigs).values({
          guildId,
          allowAllChannels: true,
          version: 1,
          updatedAt: new Date().toISOString(),
          updatedBy: "system", // 自動作成時はシステムユーザー
        });

        logger.info("Created default config for new guild", { guildId });
        reconciledCount++;
      }
    }
  }

  if (reconciledCount > 0) {
    logger.info("Reconciled guilds", { count: reconciledCount });
  } else {
    logger.info("All guilds are up to date");
  }
}
