import { Discord } from "arctic";
import { createLogger } from "./logger";

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
export function createAuthorizationURL(state: string): URL {
  return discord.createAuthorizationURL(state, ["identify", "guilds"]);
}

/**
 * 認証コードをアクセストークンに交換
 */
export async function validateAuthorizationCode(code: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const tokens = await discord.validateAuthorizationCode(code);

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
