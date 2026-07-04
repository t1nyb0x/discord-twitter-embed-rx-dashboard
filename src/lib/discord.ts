import { Discord, generateCodeVerifier } from "arctic";

export { generateCodeVerifier };

import { createLogger } from "./logger";
import { redis } from "./redis";

const logger = createLogger("Discord");

const CLIENT_ID = process.env.DISCORD_OAUTH2_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DISCORD_OAUTH2_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.DISCORD_OAUTH2_REDIRECT_URI || "";

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  logger.error("Discord OAuth2 credentials not configured");
  process.exit(1);
}

// Arctic Discord Provider の初期化
export const discord = new Discord(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

export interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

/**
 * Discord OAuth2の認証URLを生成
 */
export function createAuthorizationURL(state: string, codeVerifier: string): URL {
  return discord.createAuthorizationURL(state, codeVerifier, ["identify", "guilds"]);
}

/**
 * 認証コードをアクセストークンに交換
 */
export async function validateAuthorizationCode(code: string, codeVerifier: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const tokens = await discord.validateAuthorizationCode(code, codeVerifier);

  return {
    accessToken: tokens.accessToken(),
    expiresIn: tokens.accessTokenExpiresInSeconds() || 604800, // デフォルト7日
  };
}

/**
 * Discordユーザー情報を取得
 */
export async function getDiscordUser(accessToken: string): Promise<DiscordUser> {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user: ${response.status}`);
  }

  return response.json();
}

/**
 * Discordギルド一覧を取得
 */
export async function getDiscordGuilds(accessToken: string): Promise<DiscordGuild[]> {
  const response = await fetch("https://discord.com/api/users/@me/guilds", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch guilds: ${response.status}`);
  }

  return response.json();
}

// Discord 権限ビットフラグ
const MANAGE_GUILD = BigInt(0x20);
const ADMINISTRATOR = BigInt(0x8);

/**
 * ユーザーが指定ギルドに対して管理権限（MANAGE_GUILD または ADMINISTRATOR）を持っているか検証
 * Redis キャッシュを優先し、キャッシュミス時のみ Discord API を呼び出す
 * @returns true: 権限あり, false: 権限なし
 */
export async function verifyUserGuildPermission(
  accessToken: string,
  guildId: string,
  userId?: string,
): Promise<boolean> {
  try {
    let guilds: DiscordGuild[];

    // キャッシュからギルド一覧を取得
    if (userId) {
      const cached = await redis.get(`app:user:${userId}:guilds`);
      if (cached) {
        guilds = JSON.parse(cached);
      } else {
        // キャッシュミス: API から取得してキャッシュ
        guilds = await getDiscordGuilds(accessToken);
        await redis.setex(`app:user:${userId}:guilds`, 60 * 60, JSON.stringify(guilds));
      }
    } else {
      guilds = await getDiscordGuilds(accessToken);
    }

    const targetGuild = guilds.find((g) => g.id === guildId);

    if (!targetGuild) {
      return false;
    }

    const permissions = BigInt(targetGuild.permissions || "0");
    return (
      (permissions & MANAGE_GUILD) !== BigInt(0) || (permissions & ADMINISTRATOR) !== BigInt(0)
    );
  } catch (err) {
    logger.error("Failed to verify guild permission", {
      guildId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
