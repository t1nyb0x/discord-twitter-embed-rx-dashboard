import { encodeBase32LowerCaseNoPadding } from "oslo/encoding";
import { redis } from "./redis";

// セッション有効期限: 7日間
const SESSION_TTL = 7 * 24 * 60 * 60; // seconds

export interface Session {
  id: string;
  userId: string;
  encryptedAccessToken: string;
  expiresAt: number;
}

export interface User {
  id: string;
  discordId: string;
  username: string;
  avatar: string | null;
}

/**
 * セッションIDを生成（Oslo の generateIdFromEntropySize 相当）
 */
export function generateSessionId(): string {
  const bytes = new Uint8Array(20); // 160 bits
  crypto.getRandomValues(bytes);
  return encodeBase32LowerCaseNoPadding(bytes);
}

/**
 * セッションを作成
 */
export async function createSession(userId: string, encryptedAccessToken: string, expiresIn: number): Promise<Session> {
  const sessionId = generateSessionId();
  const expiresAt = Date.now() + expiresIn * 1000;

  const session: Session = {
    id: sessionId,
    userId,
    encryptedAccessToken,
    expiresAt,
  };

  // Redis に保存（TTL 付き）
  await redis.setex(`lucia:session:${sessionId}`, SESSION_TTL, JSON.stringify(session));

  return session;
}

/**
 * セッションを検証・取得
 */
export async function validateSession(sessionId: string): Promise<{
  session: Session;
  user: User;
} | null> {
  const sessionData = await redis.get(`lucia:session:${sessionId}`);

  if (!sessionData) {
    return null;
  }

  const session: Session = JSON.parse(sessionData);

  // セッションの有効期限チェック（二重チェック）
  if (session.expiresAt < Date.now()) {
    await invalidateSession(sessionId);
    return null;
  }

  // ユーザー情報を構築（Redis に別途保存していないため、セッションから復元）
  // 実際の実装では、ユーザー情報を別途 Redis に保存することも検討可能
  const user: User = {
    id: session.userId,
    discordId: session.userId,
    username: "", // 必要に応じて別途取得
    avatar: null,
  };

  return { session, user };
}

/**
 * セッションを無効化
 */
export async function invalidateSession(sessionId: string): Promise<void> {
  await redis.del(`lucia:session:${sessionId}`);
}

/**
 * Cookie 属性を取得
 */
export function getSessionCookieAttributes(secure: boolean = true) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL,
  };
}
