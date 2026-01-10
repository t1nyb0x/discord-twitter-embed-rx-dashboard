import { defineMiddleware } from "astro:middleware";
import { validateSession, getSessionCookieAttributes } from "./lib/auth";

// セッションクッキー名
const SESSION_COOKIE_NAME = "session";

export const onRequest = defineMiddleware(async (context, next) => {
  const sessionId = context.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;

  // P0: 認証が必要なページのパス
  const protectedPaths = ["/dashboard"];
  const isProtectedPath = protectedPaths.some((path) => context.url.pathname.startsWith(path));

  if (!sessionId) {
    context.locals.user = null;
    context.locals.session = null;

    // P0: 保護されたページにアクセスしようとした場合、再ログインページへリダイレクト
    if (isProtectedPath) {
      return context.redirect("/auth/session-expired?message=ログインが必要です");
    }

    return next();
  }

  const result = await validateSession(sessionId);

  if (!result) {
    // セッション無効 - Cookie をクリア
    context.cookies.delete(SESSION_COOKIE_NAME, {
      path: "/",
    });

    // P0: セッションが無効な場合、再ログインページへリダイレクト
    if (isProtectedPath) {
      return context.redirect("/auth/session-expired?message=セッションの有効期限が切れました");
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

  return next();
});
