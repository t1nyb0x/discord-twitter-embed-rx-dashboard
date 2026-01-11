import { base32 } from "oslo/encoding";
import { eq } from "drizzle-orm";
import { redis } from "./redis";
import { db } from "./db";
import { users } from "./db/schema";

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
 * セッションIDを生成（Oslo の base32 encoding を使用）
 */
export function generateSessionId(): string {
  const bytes = new Uint8Array(20); // 160 bits
  crypto.getRandomValues(bytes);
  return base32.encode(bytes);
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

  // ユーザー情報をDBから取得
  const dbUser = await db.select().from(users).where(eq(users.id, session.userId)).get();

  if (!dbUser) {
    // ユーザーが存在しない場合はセッションを無効化
    await invalidateSession(sessionId);
    return null;
  }

  const user: User = {
    id: dbUser.id,
    discordId: dbUser.discordId,
    username: dbUser.username,
    avatar: dbUser.avatar,
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
