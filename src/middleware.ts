import { defineMiddleware } from "astro:middleware";

import { validateSession, getSessionCookieAttributes } from "./lib/auth";
import { isCrossSiteFormRequest } from "./lib/origin-check";
import { isOwner } from "./lib/owner";
import { initializeApp } from "./startup";

// セッションクッキー名
const SESSION_COOKIE_NAME = "session";

// Bot の持ち主のみがアクセスできるページ
const OWNER_ONLY_PATHS = ["/dashboard/announcements"];

// モジュール読み込み時（サーバー起動時）に初期化を開始
const initPromise = initializeApp();

/**
 * セキュリティヘッダーを付与するヘルパー
 * 全レスポンスに共通のセキュリティヘッダーを追加する
 */
function addSecurityHeaders(response: Response): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-XSS-Protection", "0");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export const onRequest = defineMiddleware(async (context, next) => {
  // 初期化完了を待機（初回リクエスト時のみブロック）
  await initPromise;

  // CSRF（Origin）チェック: クロスサイトのフォーム送信を拒否する
  if (isCrossSiteFormRequest(context.request, context.url)) {
    return addSecurityHeaders(
      new Response("Cross-site form submissions are forbidden", { status: 403 }),
    );
  }

  const sessionId = context.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;

  // P0: 認証が必要なページのパス
  const protectedPaths = ["/dashboard"];
  const isProtectedPath = protectedPaths.some((path) => context.url.pathname.startsWith(path));

  if (!sessionId) {
    context.locals.user = null;
    context.locals.session = null;

    // P0: 保護されたページにアクセスしようとした場合、再ログインページへリダイレクト
    if (isProtectedPath) {
      return context.redirect(
        "/auth/session-expired?message=" + encodeURIComponent("ログインが必要です"),
      );
    }

    return addSecurityHeaders(await next());
  }

  const result = await validateSession(sessionId);

  if (!result) {
    // セッション無効 - Cookie をクリア
    context.cookies.delete(SESSION_COOKIE_NAME, {
      path: "/",
    });

    // P0: セッションが無効な場合、再ログインページへリダイレクト
    if (isProtectedPath) {
      return context.redirect(
        "/auth/session-expired?message=" + encodeURIComponent("セッションの有効期限が切れました"),
      );
    }

    context.locals.user = null;
    context.locals.session = null;
  } else {
    // セッション有効
    const { session, user } = result;

    // Cookie を更新（TTL を延長）
    const isSecure = process.env.NODE_ENV === "production";
    const cookieAttributes = getSessionCookieAttributes(isSecure);

    context.cookies.set(SESSION_COOKIE_NAME, session.id, cookieAttributes);

    context.locals.user = user;
    context.locals.session = session;
  }

  context.locals.url = context.url;

  // オーナー専用ページ: 存在を伏せるため 404 を返す
  const isOwnerOnlyPath = OWNER_ONLY_PATHS.some((path) => context.url.pathname.startsWith(path));
  if (isOwnerOnlyPath && !isOwner(context.locals.user)) {
    return addSecurityHeaders(new Response("Not Found", { status: 404 }));
  }

  return addSecurityHeaders(await next());
});
