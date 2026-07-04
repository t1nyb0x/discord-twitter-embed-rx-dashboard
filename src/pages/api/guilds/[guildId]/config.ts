import { MAX_URLS_PER_MESSAGE_LIMIT } from "@rx-twitter/shared";
import type { APIRoute } from "astro";

import { createApiError, createApiResponseWithHeaders, getAccessToken } from "@/lib/api-helpers";
import {
  createDefaultGuildConfig,
  findChannelWhitelist,
  findGuildConfig,
  saveGuildConfig,
} from "@/lib/db/repositories/guild-config";
import { verifyUserGuildPermission } from "@/lib/discord";
import { createLogger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";

const logger = createLogger("API:GuildConfig");

/**
 * ギルド設定を取得
 * GET /api/guilds/:guildId/config
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  const session = locals.session;
  const { guildId } = params;

  if (!user || !session) {
    return createApiError("UNAUTHORIZED", "ログインが必要です", 401);
  }

  // P1: レート制限チェック（ユーザーごと: 10req/10sec）
  const rateLimitResult = await checkRateLimit(`user:${user.id}:config:read`, 10, 10);
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
      },
    );
  }

  if (!guildId) {
    return createApiError("INVALID_GUILD_ID", "ギルドIDが不正です", 400);
  }

  try {
    // 認可チェック: ユーザーがこのギルドの管理権限を持っているか検証
    const accessToken = await getAccessToken(session.id);
    if (!accessToken) {
      return createApiError(
        "TOKEN_EXPIRED",
        "セッションの有効期限が切れました。再ログインしてください。",
        401,
      );
    }

    const hasPermission = await verifyUserGuildPermission(accessToken, guildId, user.id);
    if (!hasPermission) {
      return createApiError("FORBIDDEN", "このサーバーの設定を閲覧する権限がありません", 403);
    }

    // Bot が参加しているか確認
    const botJoined = await redis.exists(`app:guild:${guildId}:joined`);
    if (botJoined === 0) {
      return createApiError(
        "BOT_NOT_JOINED_OR_OFFLINE",
        "Bot がこのサーバーに参加していないか、オフラインの可能性があります",
        404,
      );
    }

    let config = await findGuildConfig(guildId);

    // P1: 設定が存在しない場合はデフォルトを作成（INSERT OR IGNORE で冪等化）
    if (!config) {
      try {
        config = await createDefaultGuildConfig(guildId, user.id);
      } catch (err) {
        logger.error("Failed to create default config", {
          guildId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!config) {
      return createApiError("CONFIG_CREATE_FAILED", "設定の作成に失敗しました", 500);
    }

    const whitelist = await findChannelWhitelist(guildId);

    return createApiResponseWithHeaders(
      {
        guildId: config.guildId,
        allowAllChannels: config.allowAllChannels,
        whitelistedChannelIds: whitelist.map((w) => w.channelId),
        version: config.version,
        updatedAt: config.updatedAt,
        maxUrlsPerMessage: config.maxUrlsPerMessage ?? null,
      },
      200,
      {
        // P1: ETag 形式の厳格化
        ETag: `"${config.version}"`,
      },
    );
  } catch (err) {
    logger.error("Failed to fetch guild config", {
      guildId,
      error: err instanceof Error ? err.message : String(err),
    });
    return createApiError("INTERNAL_ERROR", "設定の取得に失敗しました", 500);
  }
};

/**
 * ギルド設定を保存
 * PUT /api/guilds/:guildId/config
 */
export const PUT: APIRoute = async ({ params, locals, request }) => {
  const user = locals.user;
  const session = locals.session;
  const { guildId } = params;

  if (!user || !user.id || !session) {
    return createApiError("UNAUTHORIZED", "ログインが必要です", 401);
  }

  // P1: レート制限チェック（ユーザーごと: 5req/60sec - 更新は厳しく）
  const rateLimitResult = await checkRateLimit(`user:${user.id}:config:write`, 60, 5);
  if (!rateLimitResult.allowed) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "更新が多すぎます。少しお待ちください。",
        },
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": Math.ceil(rateLimitResult.resetAt - Date.now() / 1000).toString(),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  if (!guildId) {
    return createApiError("INVALID_GUILD_ID", "ギルドIDが不正です", 400);
  }

  try {
    // 認可チェック: ユーザーがこのギルドの管理権限を持っているか検証
    const accessToken = await getAccessToken(session.id);
    if (!accessToken) {
      return createApiError(
        "TOKEN_EXPIRED",
        "セッションの有効期限が切れました。再ログインしてください。",
        401,
      );
    }

    const hasPermission = await verifyUserGuildPermission(accessToken, guildId, user.id);
    if (!hasPermission) {
      return createApiError("FORBIDDEN", "このサーバーの設定を変更する権限がありません", 403);
    }

    // Bot が参加しているか確認
    const botJoined = await redis.exists(`app:guild:${guildId}:joined`);
    if (botJoined === 0) {
      return createApiError(
        "BOT_NOT_JOINED_OR_OFFLINE",
        "Bot がこのサーバーに参加していないか、オフラインの可能性があります",
        404,
      );
    }

    // リクエストボディを取得
    const body = await request.json();
    const { allowAllChannels, whitelistedChannelIds, maxUrlsPerMessage } = body;

    if (typeof allowAllChannels !== "boolean") {
      return createApiError(
        "INVALID_REQUEST",
        "allowAllChannels は boolean 型である必要があります",
        400,
      );
    }

    if (!Array.isArray(whitelistedChannelIds)) {
      return createApiError(
        "INVALID_REQUEST",
        "whitelistedChannelIds は配列である必要があります",
        400,
      );
    }

    // バリデーション: maxUrlsPerMessage（null / undefined、または 1〜MAX_URLS_PER_MESSAGE_LIMIT の整数）
    const normalizedMaxUrls: number | null | undefined = (() => {
      if (maxUrlsPerMessage === null || maxUrlsPerMessage === undefined) return null;
      if (
        !Number.isInteger(maxUrlsPerMessage) ||
        maxUrlsPerMessage < 1 ||
        maxUrlsPerMessage > MAX_URLS_PER_MESSAGE_LIMIT
      ) {
        return undefined; // sentinel: invalid
      }
      return maxUrlsPerMessage as number;
    })();

    if (normalizedMaxUrls === undefined) {
      return createApiError(
        "INVALID_MAX_URLS",
        `maxUrlsPerMessage は 1〜${MAX_URLS_PER_MESSAGE_LIMIT} の整数、または null である必要があります`,
        400,
      );
    }

    // バリデーション: whitelist 上限 500 件
    if (whitelistedChannelIds.length > 500) {
      return createApiError("WHITELIST_LIMIT_EXCEEDED", "ホワイトリストは最大 500 件までです", 400);
    }

    // バリデーション: 各 channelId が Discord Snowflake 形式であること
    const snowflakeRegex = /^\d{17,20}$/;
    for (const channelId of whitelistedChannelIds) {
      if (typeof channelId !== "string" || !snowflakeRegex.test(channelId)) {
        return createApiError(
          "INVALID_CHANNEL_ID",
          `不正なチャンネルID: ${String(channelId).slice(0, 20)}`,
          400,
        );
      }
    }

    // P1: If-Match ヘッダーで楽観的ロック
    const ifMatch = request.headers.get("If-Match");
    if (!ifMatch) {
      return createApiError("MISSING_IF_MATCH", "If-Match ヘッダーが必要です", 412);
    }

    // P1: If-Match 形式の厳格化（"version" 形式のみ許可）
    const versionMatch = ifMatch.match(/^"(\d+)"$/);
    if (!versionMatch) {
      return createApiError("INVALID_IF_MATCH", 'If-Match は "数字" 形式である必要があります', 412);
    }

    const expectedVersion = parseInt(versionMatch[1], 10);

    const currentConfig = await findGuildConfig(guildId);

    if (!currentConfig) {
      return createApiError("CONFIG_NOT_FOUND", "設定が見つかりません", 404);
    }

    // バージョンチェック
    if (currentConfig.version !== expectedVersion) {
      return createApiError(
        "VERSION_CONFLICT",
        "設定が他のユーザーによって更新されました。ページを再読み込みしてください。",
        409,
      );
    }

    const previousWhitelist = await findChannelWhitelist(guildId);
    const previousChannelIds = previousWhitelist.map((w) => w.channelId);

    let newVersion: number;
    try {
      newVersion = saveGuildConfig({
        guildId,
        userId: user.id,
        allowAllChannels,
        whitelistedChannelIds,
        maxUrlsPerMessage: normalizedMaxUrls,
        currentConfig,
        previousChannelIds,
      });
    } catch (txErr) {
      logger.error("Transaction failed", {
        guildId,
        error: txErr instanceof Error ? txErr.message : String(txErr),
      });
      return createApiError("TRANSACTION_FAILED", "設定の保存に失敗しました", 500);
    }

    // Redis に保存
    const newConfig = {
      guildId,
      allowAllChannels,
      whitelistedChannelIds,
      version: newVersion!,
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
      maxUrlsPerMessage: normalizedMaxUrls,
    };

    try {
      await redis.set(`app:guild:${guildId}:config`, JSON.stringify(newConfig));
    } catch (redisErr) {
      logger.error("Failed to save config to Redis", {
        guildId,
        error: redisErr instanceof Error ? redisErr.message : String(redisErr),
      });
      // P0: 503 時のレスポンスに現在 version を含める（degraded mode）
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "REDIS_SAVE_FAILED",
            message:
              "設定は保存されましたが、Redis への反映に失敗しました。数分後に自動で反映されます。",
            savedVersion: newConfig.version,
            guildId,
          },
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        },
      );
    }

    // Pub/Sub で更新を通知
    let publishSuccess = true;
    try {
      await redis.publish(
        "config:update",
        JSON.stringify({
          guildId,
          version: newConfig.version,
          updatedAt: newConfig.updatedAt,
        }),
      );
    } catch (publishErr) {
      logger.error("Failed to publish update", {
        guildId,
        error: publishErr instanceof Error ? publishErr.message : String(publishErr),
      });
      publishSuccess = false;
    }

    // P1: PUBLISH 失敗時は warning を返す（200 OK）
    if (!publishSuccess) {
      return createApiResponseWithHeaders(
        {
          success: true,
          config: newConfig,
          warning: "設定は保存されましたが、即時反映できませんでした。最大5分後に反映されます。",
        },
        200,
        {
          ETag: `"${newConfig.version}"`,
        },
      );
    }

    return createApiResponseWithHeaders(
      {
        success: true,
        config: newConfig,
      },
      200,
      {
        ETag: `"${newConfig.version}"`,
      },
    );
  } catch (err) {
    logger.error("Failed to save guild config", {
      guildId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return createApiError("INTERNAL_ERROR", "設定の保存に失敗しました", 500);
  }
};
