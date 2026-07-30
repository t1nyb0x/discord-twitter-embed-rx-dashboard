import { eq } from "drizzle-orm";

import { toAnnounceTarget } from "./announce-target";
import { db } from "./db";
import { guildConfigs, channelWhitelist } from "./db/schema";
import { createLogger } from "./logger";
import { redis } from "./redis";

const logger = createLogger("Reseed");

/**
 * P1: スキーマバージョン定義
 * Redis データ構造が変更された場合はこれをインクリメント
 *
 * 3: ホワイトリストのキー名を whitelist から whitelistedChannelIds に修正した。
 *    旧形式で書かれた既存エントリを一掃するため全再シードが必要。
 */
const CURRENT_SCHEMA_VERSION = 3;
const SCHEMA_VERSION_KEY = "app:config:schema_version";

function configKey(guildId: string): string {
  return `app:guild:${guildId}:config`;
}

type ConfigVersionRow = { guildId: string; version: number };

/**
 * Redis の設定が SQLite と乖離しているか判定する。
 *
 * SQLite が source of truth なので、欠落・破損・version 不一致はすべて
 * 「要再シード」として扱う。キーの存在だけを見ると、Redis への書き込みに
 * 失敗して古い設定が残ったケースを永久に取りこぼす。
 */
export function isRedisConfigStale(rawRedisValue: string | null, sqliteVersion: number): boolean {
  if (!rawRedisValue) {
    return true;
  }

  try {
    const parsed = JSON.parse(rawRedisValue);
    if (typeof parsed?.version !== "number") {
      return true;
    }
    return parsed.version !== sqliteVersion;
  } catch {
    return true;
  }
}

/**
 * P1対応: Redis 側が欠落・破損・古いギルドを洗い出す
 */
async function findOutdatedConfigs(configs: ConfigVersionRow[]): Promise<string[]> {
  const outdated: string[] = [];

  for (const config of configs) {
    const raw = await redis.get(configKey(config.guildId));
    if (isRedisConfigStale(raw, config.version)) {
      outdated.push(config.guildId);
    }
  }

  return outdated;
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
    const needsFullReseed =
      !storedVersion || parseInt(storedVersion, 10) !== CURRENT_SCHEMA_VERSION;

    if (needsFullReseed) {
      logger.info("Schema version mismatch, performing full reseed", {
        storedVersion,
        currentVersion: CURRENT_SCHEMA_VERSION,
      });
      await performFullReseed();
      return;
    }

    // P1: 欠落・破損・version 不一致のチェック
    const allConfigs = await db.select().from(guildConfigs);

    if (allConfigs.length === 0) {
      logger.info("No configs found in SQLite");
      return;
    }

    const outdatedGuildIds = await findOutdatedConfigs(allConfigs);

    if (outdatedGuildIds.length > 0) {
      logger.info("Found outdated configs, reseeding them", { count: outdatedGuildIds.length });
      await reseedSpecificGuilds(outdatedGuildIds);
      logger.info("Partial reseed completed", { count: outdatedGuildIds.length });
    } else {
      logger.info("All configs are up to date in Redis, no reseed needed");
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
  const config = await db
    .select()
    .from(guildConfigs)
    .where(eq(guildConfigs.guildId, guildId))
    .limit(1);

  if (config.length === 0) {
    logger.warn("Config not found for guild", { guildId });
    return;
  }

  const whitelist = await db
    .select()
    .from(channelWhitelist)
    .where(eq(channelWhitelist.guildId, guildId));

  // お知らせ配信先は未設定なら書き込まない（Bot 側のデフォルト解決に委ねる）
  const announceTarget = toAnnounceTarget({
    announceTargetMode: config[0].announceTargetMode ?? null,
    announceTargetChannelId: config[0].announceTargetChannelId ?? null,
  });

  // キー名は共有型 GuildConfig に合わせる。Bot は whitelistedChannelIds を読む
  const configData = {
    guildId: config[0].guildId,
    allowAllChannels: config[0].allowAllChannels,
    whitelistedChannelIds: whitelist.map((w) => w.channelId),
    version: config[0].version,
    updatedAt: config[0].updatedAt,
    maxUrlsPerMessage: config[0].maxUrlsPerMessage ?? undefined,
    ...(announceTarget ? { announceTarget } : {}),
  };

  // Redisに保存（TTLなし = 永続）
  await redis.set(configKey(guildId), JSON.stringify(configData));
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
    const raw = await redis.get(configKey(guildId));

    const config = await db
      .select()
      .from(guildConfigs)
      .where(eq(guildConfigs.guildId, guildId))
      .limit(1);

    if (config.length === 0) {
      // SQLite に無いが Redis にはある場合は、素性が分からないので触らない
      if (raw) {
        continue;
      }

      // 初回参加の場合、デフォルト設定を作成
      const defaultConfig = {
        guildId,
        allowAllChannels: true, // デフォルトは全チャンネル許可
        whitelistedChannelIds: [],
        version: 1,
        updatedAt: new Date().toISOString(),
      };

      await redis.set(configKey(guildId), JSON.stringify(defaultConfig));

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
      continue;
    }

    // 欠落だけでなく、Redis への書き込み失敗で古いまま残った設定も直す
    if (!isRedisConfigStale(raw, config[0].version)) {
      continue;
    }

    await reseedSingleGuild(guildId);
    logger.info("Restored config for guild", { guildId });
    reconciledCount++;
  }

  if (reconciledCount > 0) {
    logger.info("Reconciled guilds", { count: reconciledCount });
  } else {
    logger.info("All guilds are up to date");
  }
}
