import { describe, it, expect } from "vitest";

import {
  formatAnnounceTargetLabel,
  isSameAnnounceTarget,
  parseAnnounceTarget,
  toAnnounceTarget,
} from "@/lib/announce-target";

describe("parseAnnounceTarget", () => {
  it("null を未設定として受け付ける", () => {
    const result = parseAnnounceTarget(null);
    expect(result).toEqual({
      ok: true,
      value: { announceTargetMode: null, announceTargetChannelId: null },
    });
  });

  it("undefined を未設定として受け付ける", () => {
    const result = parseAnnounceTarget(undefined);
    expect(result).toEqual({
      ok: true,
      value: { announceTargetMode: null, announceTargetChannelId: null },
    });
  });

  it("オブジェクト以外を拒否する", () => {
    expect(parseAnnounceTarget("dm").ok).toBe(false);
    expect(parseAnnounceTarget(42).ok).toBe(false);
    expect(parseAnnounceTarget([]).ok).toBe(false);
  });

  it("未知の mode を拒否する", () => {
    const result = parseAnnounceTarget({ mode: "webhook" });
    expect(result.ok).toBe(false);
  });

  it("mode が channel のとき channelId を必須にする", () => {
    const result = parseAnnounceTarget({ mode: "channel" });
    expect(result.ok).toBe(false);
  });

  it("mode が channel で有効な channelId を受け付ける", () => {
    const result = parseAnnounceTarget({ mode: "channel", channelId: "333333333333333333" });
    expect(result).toEqual({
      ok: true,
      value: { announceTargetMode: "channel", announceTargetChannelId: "333333333333333333" },
    });
  });

  it("mode が dm のとき channelId なしを受け付ける", () => {
    const result = parseAnnounceTarget({ mode: "dm" });
    expect(result).toEqual({
      ok: true,
      value: { announceTargetMode: "dm", announceTargetChannelId: null },
    });
  });

  it("mode が dm のとき channelId をフォールバック先として受け付ける", () => {
    const result = parseAnnounceTarget({ mode: "dm", channelId: "333333333333333333" });
    expect(result).toEqual({
      ok: true,
      value: { announceTargetMode: "dm", announceTargetChannelId: "333333333333333333" },
    });
  });

  it("mode が dm のときも channelId の形式を検証する", () => {
    expect(parseAnnounceTarget({ mode: "dm", channelId: "abc" }).ok).toBe(false);
  });

  it("空文字の channelId を未指定として扱う", () => {
    const result = parseAnnounceTarget({ mode: "dm", channelId: "" });
    expect(result).toEqual({
      ok: true,
      value: { announceTargetMode: "dm", announceTargetChannelId: null },
    });
  });

  it("桁数が Snowflake として不正な channelId を拒否する", () => {
    expect(parseAnnounceTarget({ mode: "channel", channelId: "1234" }).ok).toBe(false);
    expect(parseAnnounceTarget({ mode: "channel", channelId: "1".repeat(21) }).ok).toBe(false);
  });
});

describe("toAnnounceTarget", () => {
  it("mode が未設定なら null を返す", () => {
    expect(
      toAnnounceTarget({ announceTargetMode: null, announceTargetChannelId: null }),
    ).toBeNull();
  });

  it("channelId のみ残っていて mode が無い場合も null を返す", () => {
    expect(
      toAnnounceTarget({ announceTargetMode: null, announceTargetChannelId: "333333333333333333" }),
    ).toBeNull();
  });

  it("dm を mode のみに変換する", () => {
    expect(toAnnounceTarget({ announceTargetMode: "dm", announceTargetChannelId: null })).toEqual({
      mode: "dm",
    });
  });

  it("dm のフォールバックチャンネルを含める", () => {
    expect(
      toAnnounceTarget({ announceTargetMode: "dm", announceTargetChannelId: "333333333333333333" }),
    ).toEqual({ mode: "dm", channelId: "333333333333333333" });
  });

  it("channel を channelId 付きで変換する", () => {
    expect(
      toAnnounceTarget({
        announceTargetMode: "channel",
        announceTargetChannelId: "333333333333333333",
      }),
    ).toEqual({ mode: "channel", channelId: "333333333333333333" });
  });

  it("DB に不正な mode が残っていた場合は null を返す", () => {
    expect(
      toAnnounceTarget({ announceTargetMode: "webhook", announceTargetChannelId: null }),
    ).toBeNull();
  });

  it("channel なのに channelId が無い場合は null を返す", () => {
    expect(
      toAnnounceTarget({ announceTargetMode: "channel", announceTargetChannelId: null }),
    ).toBeNull();
  });
});

describe("formatAnnounceTargetLabel", () => {
  const resolve = (id: string) => (id === "333333333333333333" ? "# general" : id);

  it("未設定を Bot 側のデフォルトとして表示する", () => {
    expect(formatAnnounceTargetLabel(null)).toBe("未設定（オーナーへ DM）");
  });

  it("dm を表示する", () => {
    expect(formatAnnounceTargetLabel({ mode: "dm" })).toBe("オーナーへ DM");
  });

  it("dm のフォールバック先を併記する", () => {
    expect(
      formatAnnounceTargetLabel({ mode: "dm", channelId: "333333333333333333" }, resolve),
    ).toBe("オーナーへ DM（フォールバック: # general）");
  });

  it("channel を表示する", () => {
    expect(
      formatAnnounceTargetLabel({ mode: "channel", channelId: "333333333333333333" }, resolve),
    ).toBe("# general へ投稿");
  });

  it("解決できないチャンネルは ID をそのまま表示する", () => {
    expect(formatAnnounceTargetLabel({ mode: "channel", channelId: "999999999999999999" })).toBe(
      "999999999999999999 へ投稿",
    );
  });
});

describe("isSameAnnounceTarget", () => {
  it("どちらも未設定なら同一とみなす", () => {
    expect(isSameAnnounceTarget(null, null)).toBe(true);
    expect(isSameAnnounceTarget(undefined, null)).toBe(true);
  });

  it("未設定と dm を区別する", () => {
    expect(isSameAnnounceTarget(null, { mode: "dm" })).toBe(false);
  });

  it("mode の違いを検出する", () => {
    expect(
      isSameAnnounceTarget(
        { mode: "dm", channelId: "333333333333333333" },
        { mode: "channel", channelId: "333333333333333333" },
      ),
    ).toBe(false);
  });

  it("channelId の違いを検出する", () => {
    expect(
      isSameAnnounceTarget(
        { mode: "channel", channelId: "333333333333333333" },
        { mode: "channel", channelId: "444444444444444444" },
      ),
    ).toBe(false);
  });

  it("同じ内容なら同一とみなす", () => {
    expect(
      isSameAnnounceTarget(
        { mode: "channel", channelId: "333333333333333333" },
        { mode: "channel", channelId: "333333333333333333" },
      ),
    ).toBe(true);
  });

  it("channelId の未指定と空を同一とみなす", () => {
    expect(isSameAnnounceTarget({ mode: "dm" }, { mode: "dm", channelId: "" })).toBe(true);
  });
});
