import type { APIRoute } from "astro";
import { createApiResponse, createApiError } from "@/lib/api-helpers";
import { createLogger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";

const logger = createLogger("API:Channels");

/**
 * 利用可能なチャンネル一覧を取得
 * GET /api/guilds/:guildId/channels
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  const { guildId } = params;

  if (!user) {
    return createApiError("UNAUTHORIZED", "ログインが必要です", 401);
  }

  // P1: レート制限チェック（ユーザーごと: 15req/10sec）
  const rateLimitResult = await checkRateLimit(`user:${user.id}:channels:list`, 10, 15);
  if (!rateLimitResult.allowed) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "リクエストが多すぎます。しばらくお待ちください。",
        },
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": Math.ceil(rateLimitResult.resetAt - Date.now() / 1000).toString(),
          "Cache-Control": "no-store",
        },
      }
    );
  }

  if (!guildId) {
    return createApiError("INVALID_GUILD_ID", "ギルドIDが不正です", 400);
  }

  try {
    // Bot が参加しているか確認
    const botJoined = await redis.exists(`app:guild:${guildId}:joined`);
    if (botJoined === 0) {
      return createApiError(
        "BOT_NOT_JOINED_OR_OFFLINE",
        "Bot がこのサーバーに参加していないか、オフラインの可能性があります",
        404
      );
    }

    // Redis からチャンネル情報を取得
    const channelsData = await redis.get(`app:guild:${guildId}:channels`);

    if (!channelsData) {
      // キャッシュが存在しない場合は空配列を返す
      return createApiResponse({
        channels: [],
        cached: false,
      });
    }

    try {
      const channels = JSON.parse(channelsData);
      return createApiResponse({
        channels,
        cached: true,
      });
    } catch (err) {
      logger.error("Failed to parse channels data", {
        guildId,
        error: err instanceof Error ? err.message : String(err),
      });
      return createApiResponse({
        channels: [],
        cached: false,
      });
    }
  } catch (err) {
    logger.error("Failed to fetch channels", {
      guildId,
      error: err instanceof Error ? err.message : String(err),
    });
    return createApiError("INTERNAL_ERROR", "チャンネル一覧の取得に失敗しました", 500);
  }
};

/**
 * チャンネル情報の再取得をリクエスト
 * POST /api/guilds/:guildId/channels/refresh
 */
export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  const { guildId } = params;

  if (!user) {
    return createApiError("UNAUTHORIZED", "ログインが必要です", 401);
  }

  // P1: レート制限チェック（ユーザーごと: 3req/60sec - 再取得はコストが高い）
  const rateLimitResult = await checkRateLimit(`user:${user.id}:channels:refresh`, 60, 3);
  if (!rateLimitResult.allowed) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "再取得リクエストが多すぎます。少しお待ちください。",
        },
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": Math.ceil(rateLimitResult.resetAt - Date.now() / 1000).toString(),
          "Cache-Control": "no-store",
        },
      }
    );
  }

  if (!guildId) {
    return createApiError("INVALID_GUILD_ID", "ギルドIDが不正です", 400);
  }

  try {
    // Bot が参加しているか確認
    const botJoined = await redis.exists(`app:guild:${guildId}:joined`);
    if (botJoined === 0) {
      return createApiError(
        "BOT_NOT_JOINED_OR_OFFLINE",
        "Bot がこのサーバーに参加していないか、オフラインの可能性があります",
        404
      );
    }

    // refresh リクエストキーを設定（60秒TTL）
    await redis.setex(`app:guild:${guildId}:channels:refresh`, 60, "1");

    return createApiResponse({
      success: true,
      message: "チャンネル情報の再取得をリクエストしました。数秒お待ちください。",
    });
  } catch (err) {
    logger.error("Failed to request channel refresh", {
      guildId,
      error: err instanceof Error ? err.message : String(err),
    });
    return createApiError("INTERNAL_ERROR", "再取得リクエストに失敗しました", 500);
  }
};
