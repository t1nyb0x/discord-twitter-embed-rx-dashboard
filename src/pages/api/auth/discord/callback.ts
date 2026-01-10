import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { createSession, getSessionCookieAttributes } from "@/lib/auth";
import { encryptToken } from "@/lib/crypto";
import { generateCsrfToken } from "@/lib/csrf";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { validateAuthorizationCode, getDiscordUser, getDiscordGuilds } from "@/lib/discord";
import { redis } from "@/lib/redis";

export const GET: APIRoute = async ({ url, cookies }) => {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // stateの検証
  if (!state || !code) {
    return new Response("Invalid request", { status: 400 });
  }

  const stateKey = `oauth:state:${state}`;
  const stateExists = await redis.get(stateKey);

  if (!stateExists) {
    return new Response("Invalid or expired state", { status: 400 });
  }

  // stateを削除（ワンタイムトークン）
  await redis.del(stateKey);

  try {
    // アクセストークンを取得
    const { accessToken, expiresIn } = await validateAuthorizationCode(code);

    // ユーザー情報を取得
    const discordUser = await getDiscordUser(accessToken);

    // ユーザーをDB に保存または更新
    const existingUser = await db.select().from(users).where(eq(users.discordId, discordUser.id)).get();

    let userId: string;

    if (existingUser) {
      // 既存ユーザーの情報を更新
      userId = existingUser.id;
      await db
        .update(users)
        .set({
          username: discordUser.username,
          avatar: discordUser.avatar,
        })
        .where(eq(users.id, userId));
    } else {
      // 新規ユーザーを作成
      userId = crypto.randomUUID();
      await db.insert(users).values({
        id: userId,
        discordId: discordUser.id,
        username: discordUser.username,
        avatar: discordUser.avatar,
      });
    }

    // アクセストークンを暗号化
    const encryptedAccessToken = encryptToken(accessToken);

    // セッションを作成
    const session = await createSession(userId, encryptedAccessToken, expiresIn);

    // ギルド一覧をキャッシュ
    const guilds = await getDiscordGuilds(accessToken);
    await redis.setex(
      `app:user:${userId}:guilds`,
      60 * 60, // 1時間
      JSON.stringify(guilds)
    );

    // CSRFトークンを生成
    await generateCsrfToken(session.id);

    // Cookieをセット
    const isSecure = process.env.NODE_ENV === "production";
    const cookieAttributes = getSessionCookieAttributes(isSecure);
    cookies.set("session", session.id, cookieAttributes);

    // ダッシュボードにリダイレクト
    return Response.redirect(new URL("/dashboard", url.origin), 302);
  } catch (err) {
    console.error("[OAuth Callback] Error:", err);
    return new Response("Authentication failed", { status: 500 });
  }
};
