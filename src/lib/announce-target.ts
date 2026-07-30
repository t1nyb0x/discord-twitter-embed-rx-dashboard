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

/**
 * 配信先を人が読める表記にする（監査ログ・設定画面の表示用）。
 *
 * @param target 配信先。null / undefined は未設定
 * @param resolveChannelName チャンネルIDを表示名に解決する関数。省略時はIDをそのまま使う
 */
export function formatAnnounceTargetLabel(
  target: AnnounceTarget | null | undefined,
  resolveChannelName: (channelId: string) => string = (channelId) => channelId,
): string {
  if (!target) {
    return "未設定（オーナーへ DM）";
  }

  if (target.mode === "channel") {
    return target.channelId
      ? `${resolveChannelName(target.channelId)} へ投稿`
      : "未設定（オーナーへ DM）";
  }

  return target.channelId
    ? `オーナーへ DM（フォールバック: ${resolveChannelName(target.channelId)}）`
    : "オーナーへ DM";
}

/**
 * 配信先が同一かを判定する（監査ログの差分検出用）。
 * channelId の未指定と空文字は同じものとして扱う。
 */
export function isSameAnnounceTarget(
  a: AnnounceTarget | null | undefined,
  b: AnnounceTarget | null | undefined,
): boolean {
  if (!a || !b) {
    return !a && !b;
  }

  return a.mode === b.mode && (a.channelId || "") === (b.channelId || "");
}
