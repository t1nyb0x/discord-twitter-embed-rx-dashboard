import type { APIRoute } from "astro";
import { createApiResponse, createApiError, getAccessToken } from "@/lib/api-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";

/**
 * ギルド一覧を取得
 * GET /api/guilds
 */
export const GET: APIRoute = async ({ locals }) => {
  const { user, session } = locals;

  if (!user || !session) {
    return createApiError("UNAUTHORIZED", "ログインが必要です", 401);
  }

  // P1: レート制限チェック（ユーザーごと: 10req/10sec）
  const rateLimitResult = await checkRateLimit(`user:${user.id}:guilds:list`, 10, 10);
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

  try {
    // アクセストークンを取得
    const accessToken = await getAccessToken(session.id);

    if (!accessToken) {
      return createApiError("TOKEN_EXPIRED", "セッションの有効期限が切れました。再ログインしてください。", 401);
    }

    // Discord API からユーザーのギルド一覧を取得
    const response = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return createApiError("TOKEN_EXPIRED", "セッションの有効期限が切れました。再ログインしてください。", 401);
      }
      throw new Error(`Discord API error: ${response.status}`);
    }

    const guilds: { id: string; name: string; icon: string | null; permissions: string }[] = await response.json();

    // 管理権限を持つギルドのみフィルタ
    // MANAGE_GUILD (0x20) または ADMINISTRATOR (0x8) 権限
    const managedGuilds = guilds.filter((guild) => {
      const permissions = BigInt(guild.permissions || "0");
      const MANAGE_GUILD = BigInt(0x20);
      const ADMINISTRATOR = BigInt(0x8);
      return (permissions & MANAGE_GUILD) !== BigInt(0) || (permissions & ADMINISTRATOR) !== BigInt(0);
    });

    // Bot が参加しているかチェック（Redis の joined キー）
    const guildsWithBotStatus = await Promise.all(
      managedGuilds.map(async (guild) => {
        try {
          const joined = await redis.exists(`app:guild:${guild.id}:joined`);
          return {
            id: guild.id,
            name: guild.name,
            icon: guild.icon,
            botJoined: joined === 1,
          };
        } catch (err) {
          console.error(`[API] Failed to check bot status for guild ${guild.id}:`, err);
          return {
            id: guild.id,
            name: guild.name,
            icon: guild.icon,
            botJoined: false,
          };
        }
      })
    );

    return createApiResponse({
      guilds: guildsWithBotStatus,
    });
  } catch (err) {
    console.error("[API] Failed to fetch guilds:", err);
    return createApiError("INTERNAL_ERROR", "ギルド一覧の取得に失敗しました", 500);
  }
};
