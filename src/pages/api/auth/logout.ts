import type { APIRoute } from "astro";
import { invalidateSession } from "@/lib/auth";
import { deleteCsrfToken } from "@/lib/csrf";

export const POST: APIRoute = async ({ locals, cookies }) => {
  if (!locals.session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sessionId = locals.session.id;

  // セッションを無効化
  await invalidateSession(sessionId);

  // CSRFトークンを削除
  await deleteCsrfToken(sessionId);

  // Cookieをクリア
  cookies.delete("session", {
    path: "/",
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: new URL("/", locals.url.origin).toString(),
    },
  });
};
