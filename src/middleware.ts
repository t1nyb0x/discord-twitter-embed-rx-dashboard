import { defineMiddleware } from "astro:middleware";
import { lucia } from "./lib/auth";

export const onRequest = defineMiddleware(async (context, next) => {
  const sessionId = context.cookies.get(lucia.sessionCookieName)?.value ?? null;

  // P0: 認証が必要なページのパス
  const protectedPaths = ["/dashboard"];
  const isProtectedPath = protectedPaths.some((path) => context.url.pathname.startsWith(path));

  if (!sessionId) {
    context.locals.user = null;
    context.locals.session = null;

    // P0: 保護されたページにアクセスしようとした場合、再ログインページへリダイレクト
    if (isProtectedPath) {
      return context.redirect("/auth/session-expired?message=ログインが必要ですわ");
    }

    return next();
  }

  const { session, user } = await lucia.validateSession(sessionId);

  if (session && session.fresh) {
    const sessionCookie = lucia.createSessionCookie(session.id);
    context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
  }

  if (!session) {
    const sessionCookie = lucia.createBlankSessionCookie();
    context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

    // P0: セッションが無効な場合、再ログインページへリダイレクト
    if (isProtectedPath) {
      return context.redirect("/auth/session-expired?message=セッションの有効期限が切れましたわ");
    }
  }

  context.locals.user = user;
  context.locals.session = session;
  context.locals.url = context.url;

  return next();
});
