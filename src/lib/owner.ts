import type { User } from "./auth";
import { createLogger } from "./logger";

const logger = createLogger("Owner");

let warnedMissingEnv = false;

/**
 * Bot の持ち主（オーナー）の Discord ユーザーID。
 * Bot 側の ownerUserId と同じ値を設定する。
 */
function getOwnerDiscordId(): string | null {
  const raw = process.env.OWNER_DISCORD_ID?.trim();

  if (!raw) {
    if (!warnedMissingEnv) {
      logger.warn("OWNER_DISCORD_ID is not configured. Owner-only features are disabled.");
      warnedMissingEnv = true;
    }
    return null;
  }

  return raw;
}

/**
 * ユーザーが Bot のオーナーか判定する。
 *
 * 比較対象は Discord のユーザーID であって、Dashboard 内部のユーザーID ではない。
 * OWNER_DISCORD_ID が未設定の場合は、誰もオーナーとみなさない（fail closed）。
 */
export function isOwner(user: User | null | undefined): boolean {
  if (!user) {
    return false;
  }

  const ownerDiscordId = getOwnerDiscordId();
  if (!ownerDiscordId) {
    return false;
  }

  return user.discordId === ownerDiscordId;
}
