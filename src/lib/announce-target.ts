import type { AnnounceTarget, AnnounceTargetMode } from "@rx-twitter/shared";

/** Discord Snowflake の形式 */
const SNOWFLAKE_REGEX = /^\d{17,20}$/;

/** 受け付ける配信先モード */
const ANNOUNCE_TARGET_MODES: readonly AnnounceTargetMode[] = ["dm", "channel"];

/**
 * guild_config テーブルに保存する配信先のカラム表現。
 * 共有型の AnnounceTarget を 2 カラムに平坦化したもの。
 */
export interface AnnounceTargetColumns {
  announceTargetMode: string | null;
  announceTargetChannelId: string | null;
}

export type ParseAnnounceTargetResult =
  | { ok: true; value: AnnounceTargetColumns }
  | { ok: false; error: string };

const UNSET: AnnounceTargetColumns = {
  announceTargetMode: null,
  announceTargetChannelId: null,
};

function isAnnounceTargetMode(value: unknown): value is AnnounceTargetMode {
  return ANNOUNCE_TARGET_MODES.includes(value as AnnounceTargetMode);
}

/**
 * リクエストボディの announceTarget を検証し、保存用のカラム表現に変換する。
 *
 * null / undefined は「未設定」として扱う（Bot 側がオーナーへの DM をデフォルトとする）。
 * mode が "channel" の場合 channelId は必須、"dm" の場合は DM 失敗時のフォールバック先として任意。
 */
export function parseAnnounceTarget(input: unknown): ParseAnnounceTargetResult {
  if (input === null || input === undefined) {
    return { ok: true, value: UNSET };
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "announceTarget はオブジェクトである必要があります" };
  }

  const { mode, channelId } = input as { mode?: unknown; channelId?: unknown };

  if (!isAnnounceTargetMode(mode)) {
    return {
      ok: false,
      error: `announceTarget.mode は ${ANNOUNCE_TARGET_MODES.join(" または ")} である必要があります`,
    };
  }

  // 空文字は「未指定」として扱う（フォームの初期値がそのまま送られてくるため）
  const hasChannelId = channelId !== null && channelId !== undefined && channelId !== "";

  if (hasChannelId && (typeof channelId !== "string" || !SNOWFLAKE_REGEX.test(channelId))) {
    return { ok: false, error: "announceTarget.channelId が不正なチャンネルIDです" };
  }

  if (mode === "channel" && !hasChannelId) {
    return {
      ok: false,
      error: "配信先にチャンネルを選んだ場合は channelId が必要です",
    };
  }

  return {
    ok: true,
    value: {
      announceTargetMode: mode,
      announceTargetChannelId: hasChannelId ? (channelId as string) : null,
    },
  };
}

/**
 * 保存済みのカラム表現を共有型の AnnounceTarget に変換する。
 * 未設定・不整合な組み合わせは null を返す（Bot 側のデフォルトに委ねる）。
 */
export function toAnnounceTarget(columns: AnnounceTargetColumns): AnnounceTarget | null {
  const { announceTargetMode, announceTargetChannelId } = columns;

  if (!isAnnounceTargetMode(announceTargetMode)) {
    return null;
  }

  if (announceTargetMode === "channel") {
    return announceTargetChannelId ? { mode: "channel", channelId: announceTargetChannelId } : null;
  }

  return announceTargetChannelId
    ? { mode: "dm", channelId: announceTargetChannelId }
    : { mode: "dm" };
}
