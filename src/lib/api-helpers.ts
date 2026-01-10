interface ApiResponse<T = unknown> {
  success: true;
  data: T;
}

interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

/**
 * API レスポンスを作成
 * P1対応: Cache-Control: no-store を強制
 */
export function createApiResponse<T>(data: T, status: number = 200): Response {
  return new Response(JSON.stringify({ success: true, data } as ApiResponse<T>), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * API エラーレスポンスを作成
 * P1対応: Cache-Control: no-store を強制
 */
export function createApiError(code: string, message: string, status: number = 400): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: { code, message },
    } as ApiError),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}

/**
 * レート制限エラーを作成
 */
export function createRateLimitError(resetAt: number): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "レート制限に達しました。しばらくしてから再度お試しください。",
      },
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": Math.ceil(resetAt - Date.now() / 1000).toString(),
        "Cache-Control": "no-store",
      },
    }
  );
}

/**
 * P1対応: 404 Not Found エラーを作成
 * Bot が参加していない、またはオフラインの場合に使用
 */
export function createNotFoundError(message: string = "リソースが見つかりませんでした"): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code: "NOT_FOUND",
        message,
      },
    } as ApiError),
    {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store", // P1: キャッシュ禁止
      },
    }
  );
}

/**
 * P1対応: Bot 未参加エラーを作成
 */
export function createBotNotJoinedError(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code: "BOT_NOT_JOINED_OR_OFFLINE",
        message: "Bot がこのギルドに参加していないか、オフラインです",
      },
    } as ApiError),
    {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store", // P1: 動的データなのでキャッシュ禁止
      },
    }
  );
}

/**
 * P1対応: カスタムヘッダー付きレスポンスを作成
 */
export function createApiResponseWithHeaders<T>(
  data: T,
  status: number = 200,
  customHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify({ success: true, data } as ApiResponse<T>), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...customHeaders,
    },
  });
}

/**
 * セッションからアクセストークンを取得
 */
export async function getAccessToken(sessionId: string): Promise<string | null> {
  const { redis } = await import("./redis");
  const { decryptToken } = await import("./crypto");

  const sessionData = await redis.hgetall(`app:session:${sessionId}`);
  if (!sessionData || !sessionData.encryptedAccessToken) {
    return null;
  }

  const expiresAt = parseInt(sessionData.expiresAt as string, 10);
  if (Date.now() >= expiresAt) {
    return null; // トークン期限切れ
  }

  return decryptToken(sessionData.encryptedAccessToken as string);
}
