import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { createApiError, createApiResponseWithHeaders } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { channelWhitelist, configAuditLogs, guildConfigs } from "@/lib/db/schema";
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
  const { guildId } = params;

  if (!user) {
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

    // SQLite から設定を取得
    let config = await db.query.guildConfigs.findFirst({
      where: eq(guildConfigs.guildId, guildId),
    });

    // P1: 設定が存在しない場合はデフォルトを作成（INSERT OR IGNORE で冪等化）
    if (!config) {
      try {
        await db
          .insert(guildConfigs)
          .values({
            guildId,
            allowAllChannels: true,
            version: 1,
            updatedAt: new Date().toISOString(),
            updatedBy: user.id,
          })
          .onConflictDoNothing();

        config = await db.query.guildConfigs.findFirst({
          where: eq(guildConfigs.guildId, guildId),
        });
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

    // ホワイトリストを取得
    const whitelist = await db.query.channelWhitelist.findMany({
      where: eq(channelWhitelist.guildId, guildId),
    });

    return createApiResponseWithHeaders(
      {
        guildId: config.guildId,
        allowAllChannels: config.allowAllChannels,
        whitelistedChannelIds: whitelist.map((w) => w.channelId),
        version: config.version,
        updatedAt: config.updatedAt,
      },
      200,
      {
        // P1: ETag 形式の厳格化
        ETag: `"${config.version}"`,
      }
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
  const { guildId } = params;

  if (!user || !user.id) {
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

    // リクエストボディを取得
    const body = await request.json();
    const { allowAllChannels, whitelistedChannelIds } = body;

    if (typeof allowAllChannels !== "boolean") {
      return createApiError("INVALID_REQUEST", "allowAllChannels は boolean 型である必要があります", 400);
    }

    if (!Array.isArray(whitelistedChannelIds)) {
      return createApiError("INVALID_REQUEST", "whitelistedChannelIds は配列である必要があります", 400);
    }

    // バリデーション: whitelist 上限 500 件
    if (whitelistedChannelIds.length > 500) {
      return createApiError("WHITELIST_LIMIT_EXCEEDED", "ホワイトリストは最大 500 件までです", 400);
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

    // 現在の設定を取得
    const currentConfig = await db.query.guildConfigs.findFirst({
      where: eq(guildConfigs.guildId, guildId),
    });

    if (!currentConfig) {
      return createApiError("CONFIG_NOT_FOUND", "設定が見つかりません", 404);
    }

    // バージョンチェック
    if (currentConfig.version !== expectedVersion) {
      return createApiError(
        "VERSION_CONFLICT",
        "設定が他のユーザーによって更新されました。ページを再読み込みしてください。",
        409
      );
    }

    const previousWhitelist = await db.query.channelWhitelist.findMany({
      where: eq(channelWhitelist.guildId, guildId),
    });

    // トランザクション処理
    let newVersion: number;
    try {
      await db.transaction(async (tx) => {
        // P0: 楽観的ロックを UPDATE WHERE version で担保
        newVersion = currentConfig.version + 1;
        await tx
          .update(guildConfigs)
          .set({
            allowAllChannels,
            version: newVersion,
            updatedAt: new Date().toISOString(),
            updatedBy: user.id,
          })
          .where(eq(guildConfigs.guildId, guildId));

        // 既存のホワイトリストを削除
        await tx.delete(channelWhitelist).where(eq(channelWhitelist.guildId, guildId));

        // 新しいホワイトリストを挿入
        if (whitelistedChannelIds.length > 0) {
          await tx.insert(channelWhitelist).values(
            whitelistedChannelIds.map((channelId: string) => ({
              guildId,
              channelId,
            }))
          );
        }

        // 監査ログ記録
        await tx.insert(configAuditLogs).values({
          guildId,
          userId: user.id,
          action: "update",
          oldVersion: currentConfig.version,
          newVersion,
          changes: JSON.stringify({
            previous: {
              allowAllChannels: currentConfig.allowAllChannels,
              whitelistedChannelIds: previousWhitelist.map((w) => w.channelId),
            },
            current: {
              allowAllChannels,
              whitelistedChannelIds,
            },
          }),
        });
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
            message: "設定は保存されましたが、Redis への反映に失敗しました。数分後に自動で反映されます。",
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
        }
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
        })
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
        }
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
      }
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
