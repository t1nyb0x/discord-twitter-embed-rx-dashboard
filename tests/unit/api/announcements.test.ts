import { ANNOUNCEMENT_STREAM_FIELD, ANNOUNCEMENT_STREAM_KEY } from "@rx-twitter/shared";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { createMockLocals } from "../../helpers";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockIsOwner = vi.fn();
vi.mock("@/lib/owner", () => ({
  isOwner: (...args: unknown[]) => mockIsOwner(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockRedis = {
  xadd: vi.fn(),
};
vi.mock("@/lib/redis", () => ({
  redis: mockRedis,
}));

describe("API: /api/announcements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOwner.mockReturnValue(true);
    mockCheckRateLimit.mockResolvedValue({ allowed: true, resetAt: 0 });
    mockRedis.xadd.mockResolvedValue("1700000000000-0");
  });

  async function callPOST(
    body: unknown = { title: "メンテナンスのお知らせ", body: "本日 22 時から実施します。" },
    locals = createMockLocals(),
  ) {
    const { POST } = await import("@/pages/api/announcements/index");
    return POST({
      locals,
      request: new Request("http://localhost/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    } as any);
  }

  it("未認証の場合 401 を返す", async () => {
    const response = await callPOST(undefined, createMockLocals({ authenticated: false }));
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error.code).toBe("UNAUTHORIZED");
  });

  it("オーナーでない場合 403 を返し、ストリームに投入しない", async () => {
    mockIsOwner.mockReturnValue(false);

    const response = await callPOST();
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error.code).toBe("FORBIDDEN");
    expect(mockRedis.xadd).not.toHaveBeenCalled();
  });

  it("レート制限に達した場合 429 を返し、ストリームに投入しない", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, resetAt: Date.now() / 1000 + 60 });

    const response = await callPOST();
    expect(response.status).toBe(429);
    expect(mockRedis.xadd).not.toHaveBeenCalled();
  });

  it("タイトルが空の場合 400 を返す", async () => {
    const response = await callPOST({ title: "   ", body: "本文" });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe("INVALID_ANNOUNCEMENT");
  });

  it("本文が空の場合 400 を返す", async () => {
    const response = await callPOST({ title: "タイトル", body: "" });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe("INVALID_ANNOUNCEMENT");
  });

  it("タイトルが上限を超える場合 400 を返す", async () => {
    const response = await callPOST({ title: "あ".repeat(257), body: "本文" });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe("INVALID_ANNOUNCEMENT");
  });

  it("本文が上限を超える場合 400 を返す", async () => {
    const response = await callPOST({ title: "タイトル", body: "あ".repeat(4097) });
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe("INVALID_ANNOUNCEMENT");
  });

  it("JSON として不正なボディを 400 で拒否する", async () => {
    const { POST } = await import("@/pages/api/announcements/index");
    const response = await POST({
      locals: createMockLocals(),
      request: new Request("http://localhost/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
    } as any);

    expect(response.status).toBe(400);
    expect(mockRedis.xadd).not.toHaveBeenCalled();
  });

  it("共有パッケージのキーとフィールド名でストリームに投入する", async () => {
    const response = await callPOST();
    expect(response.status).toBe(200);

    expect(mockRedis.xadd).toHaveBeenCalledTimes(1);
    const [key, id, field, value] = mockRedis.xadd.mock.calls[0];
    expect(key).toBe(ANNOUNCEMENT_STREAM_KEY);
    expect(id).toBe("*");
    expect(field).toBe(ANNOUNCEMENT_STREAM_FIELD);

    const announcement = JSON.parse(value);
    expect(announcement.title).toBe("メンテナンスのお知らせ");
    expect(announcement.body).toBe("本日 22 時から実施します。");
    expect(typeof announcement.id).toBe("string");
    expect(announcement.id.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(announcement.createdAt))).toBe(false);
  });

  it("作成者として Discord ユーザーID を記録する", async () => {
    await callPOST();

    const announcement = JSON.parse(mockRedis.xadd.mock.calls[0][3]);
    expect(announcement.createdBy).toBe("discord-456");
  });

  it("送信ごとに異なる冪等キーを採番する", async () => {
    await callPOST();
    await callPOST();

    const first = JSON.parse(mockRedis.xadd.mock.calls[0][3]);
    const second = JSON.parse(mockRedis.xadd.mock.calls[1][3]);
    expect(first.id).not.toBe(second.id);
  });

  it("タイトルと本文の前後の空白を除去する", async () => {
    await callPOST({ title: "  タイトル  ", body: "  本文  " });

    const announcement = JSON.parse(mockRedis.xadd.mock.calls[0][3]);
    expect(announcement.title).toBe("タイトル");
    expect(announcement.body).toBe("本文");
  });

  it("成功時に採番した ID とストリームのエントリIDを返す", async () => {
    const response = await callPOST();
    const json = await response.json();

    expect(json.success).toBe(true);
    const announcement = JSON.parse(mockRedis.xadd.mock.calls[0][3]);
    expect(json.data.id).toBe(announcement.id);
    expect(json.data.entryId).toBe("1700000000000-0");
  });

  it("ストリームへの投入に失敗した場合 503 を返す", async () => {
    mockRedis.xadd.mockRejectedValue(new Error("Redis down"));

    const response = await callPOST();
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.error.code).toBe("ANNOUNCEMENT_ENQUEUE_FAILED");
  });
});
