/**
 * E2E テスト: Dashboard API
 *
 * 起動済みの Dashboard に対して HTTP で叩く。ユニットテストとは別の
 * vitest 設定（vitest.e2e.config.ts）で動くため、`npm run test` では実行されない。
 *
 * 実行方法:
 *   1. Redis を起動し、Dashboard を起動する（npm run dev もしくは Docker Compose）
 *   2. npm run test:e2e
 *   3. 別ホストを見るなら DASHBOARD_URL=http://example:4321 npm run test:e2e
 *
 * Dashboard に到達できない場合は beforeAll で失敗する。黙って緑にはしない。
 */

import { describe, it, expect, beforeAll } from "vitest";

/** Dashboard API のエラーレスポンス（このテストで参照する範囲のみ） */
interface ApiErrorResponse {
  success: boolean;
  error: { code: string };
}

const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://localhost:4321";
const TEST_GUILD_ID = "123456789012345678";
const REACHABILITY_TIMEOUT_MS = 3000;

/**
 * Dashboard の到達性を確認する。到達できなければ理由を添えて投げる。
 */
async function assertDashboardReachable(): Promise<void> {
  try {
    // トップページで判定（API エンドポイントがなくても動く）
    await fetch(DASHBOARD_URL, { signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS) });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Dashboard に到達できません: ${DASHBOARD_URL} (${reason})\n` +
        "Redis と Dashboard を起動してから npm run test:e2e を実行してください。\n" +
        "別ホストを見る場合は DASHBOARD_URL で指定してください。",
    );
  }
}

describe("E2E: Dashboard API", () => {
  beforeAll(async () => {
    await assertDashboardReachable();
  });

  // ── 認証なしアクセス: 全エンドポイントが 401 を返すこと ──

  describe("未認証リクエストの拒否", () => {
    it("GET /api/guilds → 401", async () => {
      const response = await fetch(`${DASHBOARD_URL}/api/guilds`);
      expect(response.status).toBe(401);

      const body = (await response.json()) as ApiErrorResponse;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("GET /api/guilds/:guildId/config → 401", async () => {
      const response = await fetch(`${DASHBOARD_URL}/api/guilds/${TEST_GUILD_ID}/config`);
      expect(response.status).toBe(401);

      const body = (await response.json()) as ApiErrorResponse;
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("PUT /api/guilds/:guildId/config → 401", async () => {
      const response = await fetch(`${DASHBOARD_URL}/api/guilds/${TEST_GUILD_ID}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowAllChannels: true, whitelistedChannelIds: [] }),
      });
      expect(response.status).toBe(401);

      const body = (await response.json()) as ApiErrorResponse;
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("GET /api/guilds/:guildId/audit-logs → 401", async () => {
      const response = await fetch(`${DASHBOARD_URL}/api/guilds/${TEST_GUILD_ID}/audit-logs`);
      expect(response.status).toBe(401);

      const body = (await response.json()) as ApiErrorResponse;
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("GET /api/guilds/:guildId/channels → 401", async () => {
      const response = await fetch(`${DASHBOARD_URL}/api/guilds/${TEST_GUILD_ID}/channels`);
      expect(response.status).toBe(401);

      const body = (await response.json()) as ApiErrorResponse;
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    // Origin ヘッダーは必須。Content-Type なしの POST は middleware の
    // CSRF（Origin）チェック対象で、Origin が無いと 401 ではなく 403 になる。
    it("POST /api/guilds/:guildId/channels → 401", async () => {
      const response = await fetch(`${DASHBOARD_URL}/api/guilds/${TEST_GUILD_ID}/channels`, {
        method: "POST",
        headers: { Origin: DASHBOARD_URL },
      });
      expect(response.status).toBe(401);

      const body = (await response.json()) as ApiErrorResponse;
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    // logout は API エンベロープではなく素の "Unauthorized" を返すため status のみ検証する。
    it("POST /api/auth/logout → 401", async () => {
      const response = await fetch(`${DASHBOARD_URL}/api/auth/logout`, {
        method: "POST",
        redirect: "manual",
        headers: { Origin: DASHBOARD_URL },
      });
      expect(response.status).toBe(401);
    });
  });

  // ── OAuth ログインフロー ──

  describe("OAuth ログインフロー", () => {
    it("GET /api/auth/discord/login → Discord へリダイレクトする", async () => {
      const response = await fetch(`${DASHBOARD_URL}/api/auth/discord/login`, {
        redirect: "manual",
      });
      expect(response.status).toBe(302);

      const location = response.headers.get("Location");
      expect(location).toBeDefined();
      expect(location).toContain("discord.com");
      expect(location).toContain("oauth2");
    });
  });

  // ── セキュリティヘッダー ──

  describe("セキュリティヘッダー", () => {
    it("API レスポンスに Cache-Control: no-store が含まれる", async () => {
      const response = await fetch(`${DASHBOARD_URL}/api/guilds`);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Content-Type")).toBe("application/json");
    });

    it("API レスポンスにセキュリティヘッダーが含まれる", async () => {
      const response = await fetch(`${DASHBOARD_URL}/api/guilds`);

      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(response.headers.get("X-XSS-Protection")).toBe("0");
      expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
    });
  });

  // ── 不正リクエスト ──

  describe("不正リクエストの拒否", () => {
    it("無効なセッション Cookie では 401 になる", async () => {
      const response = await fetch(`${DASHBOARD_URL}/api/guilds`, {
        headers: {
          Cookie: "session=invalid-session-id-that-does-not-exist",
        },
      });
      expect(response.status).toBe(401);
    });
  });
});
