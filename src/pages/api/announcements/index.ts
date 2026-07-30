import {
  ANNOUNCEMENT_STREAM_FIELD,
  ANNOUNCEMENT_STREAM_KEY,
  validateAnnouncement,
  type Announcement,
} from "@rx-twitter/shared";
import type { APIRoute } from "astro";

import { createApiError, createApiResponse, createRateLimitError } from "@/lib/api-helpers";
import { createLogger } from "@/lib/logger";
import { isOwner } from "@/lib/owner";
import { checkRateLimit } from "@/lib/rate-limit";
import { redis } from "@/lib/redis";

const logger = createLogger("API:Announcements");

/** 全サーバーへの一斉配信なので、送信は厳しく制限する（10分あたり5件） */
const RATE_LIMIT_WINDOW_SECONDS = 600;
const RATE_LIMIT_MAX = 5;

/**
 * お知らせを全サーバーへ配信する
 * POST /api/announcements
 *
 * Redis Streams に投入し、Bot 側の consumer group が配信する。
 * 詳細は Bot 側 ADR 0003 を参照。
 */
export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;

  if (!user) {
    return createApiError("UNAUTHORIZED", "ログインが必要です", 401);
  }

  // お知らせの作成・配信は Bot の持ち主のみ
  if (!isOwner(user)) {
    return createApiError("FORBIDDEN", "この操作を行う権限がありません", 403);
  }

  const rateLimitResult = await checkRateLimit(
    `user:${user.id}:announcement:send`,
    RATE_LIMIT_WINDOW_SECONDS,
    RATE_LIMIT_MAX,
  );
  if (!rateLimitResult.allowed) {
    return createRateLimitError(rateLimitResult.resetAt);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return createApiError("INVALID_REQUEST", "リクエストボディが不正です", 400);
  }

  const { title, body: content } = (body ?? {}) as { title?: unknown; body?: unknown };

  // id は冪等キーとして Bot 側の重複配信防止に使われるため、サーバー側で採番する
  const announcement: Announcement = {
    id: crypto.randomUUID(),
    title: typeof title === "string" ? title.trim() : "",
    body: typeof content === "string" ? content.trim() : "",
    createdAt: new Date().toISOString(),
    createdBy: user.discordId,
  };

  // Bot 側と同じ検証をここでも通す（不正な投入は Bot 側で dead-letter になる）
  const validation = validateAnnouncement(announcement);
  if (!validation.ok) {
    return createApiError("INVALID_ANNOUNCEMENT", validation.error, 400);
  }

  let entryId: string | null;
  try {
    entryId = await redis.xadd(
      ANNOUNCEMENT_STREAM_KEY,
      "*",
      ANNOUNCEMENT_STREAM_FIELD,
      JSON.stringify(validation.value),
    );
  } catch (err) {
    logger.error("Failed to enqueue announcement", {
      announcementId: announcement.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return createApiError(
      "ANNOUNCEMENT_ENQUEUE_FAILED",
      "お知らせの送信に失敗しました。時間をおいて再度お試しください。",
      503,
    );
  }

  logger.info("Announcement enqueued", {
    announcementId: announcement.id,
    entryId,
    createdBy: user.discordId,
  });

  return createApiResponse({ id: announcement.id, entryId });
};
