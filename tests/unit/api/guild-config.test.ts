import { describe, it, expect, vi, beforeEach } from "vitest";

import { createMockLocals } from "../../helpers";

// 共通モック
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockGetAccessToken = vi.fn();
vi.mock("@/lib/api-helpers", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
  };
});

const mockVerifyUserGuildPermission = vi.fn();
vi.mock("@/lib/discord", () => ({
  verifyUserGuildPermission: (...args: unknown[]) => mockVerifyUserGuildPermission(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockRedis = {
  exists: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
};
vi.mock("@/lib/redis", () => ({
  redis: mockRedis,
}));

const mockFindGuildConfig = vi.fn();
const mockFindChannelWhitelist = vi.fn();
const mockCreateDefaultGuildConfig = vi.fn();
const mockSaveGuildConfig = vi.fn();
vi.mock("@/lib/db/repositories/guild-config", () => ({
  findGuildConfig: (...args: unknown[]) => mockFindGuildConfig(...args),
  findChannelWhitelist: (...args: unknown[]) => mockFindChannelWhitelist(...args),
  createDefaultGuildConfig: (...args: unknown[]) => mockCreateDefaultGuildConfig(...args),
  saveGuildConfig: (...args: unknown[]) => mockSaveGuildConfig(...args),
}));

describe("API: /api/guilds/[guildId]/config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true, resetAt: 0 });
    mockGetAccessToken.mockResolvedValue("valid-access-token");
    mockVerifyUserGuildPermission.mockResolvedValue(true);
    mockRedis.exists.mockResolvedValue(1);
    mockFindGuildConfig.mockResolvedValue(undefined);
    mockFindChannelWhitelist.mockResolvedValue([]);
    mockCreateDefaultGuildConfig.mockResolvedValue(undefined);
    mockSaveGuildConfig.mockReturnValue(2);
  });

  describe("GET", () => {
    async function callGET(guildId: string = "123456789012345678", locals = createMockLocals()) {
      const { GET } = await import("@/pages/api/guilds/[guildId]/config");
      return GET({
        params: { guildId },
        locals,
        request: new Request("http://localhost/api/guilds/" + guildId + "/config"),
      } as any);
    }

    it("未認証の場合 401 を返す", async () => {
      const response = await callGET(
        "123456789012345678",
        createMockLocals({ authenticated: false }),
      );
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("レート制限に達した場合 429 を返す", async () => {
      mockCheckRateLimit.mockResolvedValue({ allowed: false, resetAt: Date.now() / 1000 + 60 });

      const response = await callGET();
      expect(response.status).toBe(429);
    });

    it("アクセストークンが無効の場合 401 を返す", async () => {
      mockGetAccessToken.mockResolvedValue(null);

      const response = await callGET();
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe("TOKEN_EXPIRED");
    });

    it("ギルド権限がない場合 403 を返す", async () => {
      mockVerifyUserGuildPermission.mockResolvedValue(false);

      const response = await callGET();
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("Bot が未参加の場合 404 を返す", async () => {
      mockRedis.exists.mockResolvedValue(0);

      const response = await callGET();
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error.code).toBe("BOT_NOT_JOINED_OR_OFFLINE");
    });

    it("設定が存在する場合 200 と設定データを返す", async () => {
      mockFindGuildConfig.mockResolvedValue({
        guildId: "123456789012345678",
        allowAllChannels: true,
        version: 1,
        updatedAt: "2024-01-01T00:00:00.000Z",
      });
      mockFindChannelWhitelist.mockResolvedValue([
        { channelId: "111111111111111111" },
        { channelId: "222222222222222222" },
      ]);

      const response = await callGET();
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.guildId).toBe("123456789012345678");
      expect(body.data.allowAllChannels).toBe(true);
      expect(body.data.whitelistedChannelIds).toEqual(["111111111111111111", "222222222222222222"]);
      expect(body.data.version).toBe(1);

      // ETag ヘッダーを検証
      expect(response.headers.get("ETag")).toBe('"1"');
    });
  });

  describe("PUT", () => {
    function createPUTRequest(guildId: string, body: Record<string, unknown>, ifMatch?: string) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (ifMatch) {
        headers["If-Match"] = ifMatch;
      }
      return new Request(`http://localhost/api/guilds/${guildId}/config`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      });
    }

    async function callPUT(
      guildId: string = "123456789012345678",
      body: Record<string, unknown> = { allowAllChannels: true, whitelistedChannelIds: [] },
      ifMatch: string = '"1"',
      locals = createMockLocals(),
    ) {
      const { PUT } = await import("@/pages/api/guilds/[guildId]/config");
      return PUT({
        params: { guildId },
        locals,
        request: createPUTRequest(guildId, body, ifMatch),
      } as any);
    }

    it("未認証の場合 401 を返す", async () => {
      const response = await callPUT(
        "123456789012345678",
        { allowAllChannels: true, whitelistedChannelIds: [] },
        '"1"',
        createMockLocals({ authenticated: false }),
      );
      expect(response.status).toBe(401);
    });

    it("レート制限に達した場合 429 を返す", async () => {
      mockCheckRateLimit.mockResolvedValue({ allowed: false, resetAt: Date.now() / 1000 + 60 });

      const response = await callPUT();
      expect(response.status).toBe(429);
    });

    it("権限がない場合 403 を返す", async () => {
      mockVerifyUserGuildPermission.mockResolvedValue(false);

      const response = await callPUT();
      expect(response.status).toBe(403);
    });

    it("allowAllChannels が boolean でない場合 400 を返す", async () => {
      const response = await callPUT("123456789012345678", {
        allowAllChannels: "yes",
        whitelistedChannelIds: [],
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_REQUEST");
    });

    it("whitelistedChannelIds が配列でない場合 400 を返す", async () => {
      const response = await callPUT("123456789012345678", {
        allowAllChannels: true,
        whitelistedChannelIds: "not-array",
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_REQUEST");
    });

    it("whitelistedChannelIds が 500 件を超える場合 400 を返す", async () => {
      const ids = Array.from({ length: 501 }, (_, i) => `1${String(i).padStart(19, "0")}`);
      const response = await callPUT("123456789012345678", {
        allowAllChannels: false,
        whitelistedChannelIds: ids,
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("WHITELIST_LIMIT_EXCEEDED");
    });

    it("不正な channelId 形式を拒否する", async () => {
      const response = await callPUT("123456789012345678", {
        allowAllChannels: false,
        whitelistedChannelIds: ["invalid-id"],
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_CHANNEL_ID");
    });

    it("短すぎる channelId を拒否する", async () => {
      const response = await callPUT("123456789012345678", {
        allowAllChannels: false,
        whitelistedChannelIds: ["1234"],
      });
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_CHANNEL_ID");
    });

    it("If-Match ヘッダーがない場合 412 を返す", async () => {
      const { PUT } = await import("@/pages/api/guilds/[guildId]/config");
      const response = await PUT({
        params: { guildId: "123456789012345678" },
        locals: createMockLocals(),
        request: new Request("http://localhost/api/guilds/123456789012345678/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ allowAllChannels: true, whitelistedChannelIds: [] }),
        }),
      } as any);
      expect(response.status).toBe(412);
      const body = await response.json();
      expect(body.error.code).toBe("MISSING_IF_MATCH");
    });

    it("If-Match 形式が不正な場合 412 を返す", async () => {
      const response = await callPUT(
        "123456789012345678",
        {
          allowAllChannels: true,
          whitelistedChannelIds: [],
        },
        "invalid-format",
      );
      expect(response.status).toBe(412);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_IF_MATCH");
    });

    it("バージョン不一致の場合 409 を返す", async () => {
      mockFindGuildConfig.mockResolvedValue({
        guildId: "123456789012345678",
        allowAllChannels: true,
        version: 2,
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      const response = await callPUT(
        "123456789012345678",
        {
          allowAllChannels: false,
          whitelistedChannelIds: [],
        },
        '"1"',
      );
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe("VERSION_CONFLICT");
    });
  });
});
