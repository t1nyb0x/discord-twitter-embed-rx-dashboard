import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createMockUser } from "../../helpers";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("isOwner", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function isOwner(user: Parameters<typeof createMockUser>[0] | null) {
    const mod = await import("@/lib/owner");
    return mod.isOwner(user === null ? null : createMockUser(user));
  }

  it("OWNER_DISCORD_ID が未設定なら誰もオーナーとみなさない", async () => {
    vi.stubEnv("OWNER_DISCORD_ID", "");

    expect(await isOwner({ discordId: "111111111111111111" })).toBe(false);
  });

  it("null ユーザーを拒否する", async () => {
    vi.stubEnv("OWNER_DISCORD_ID", "111111111111111111");

    expect(await isOwner(null)).toBe(false);
  });

  it("discordId が一致する場合のみ true を返す", async () => {
    vi.stubEnv("OWNER_DISCORD_ID", "111111111111111111");

    expect(await isOwner({ discordId: "111111111111111111" })).toBe(true);
  });

  it("discordId が一致しない場合 false を返す", async () => {
    vi.stubEnv("OWNER_DISCORD_ID", "111111111111111111");

    expect(await isOwner({ discordId: "222222222222222222" })).toBe(false);
  });

  it("内部ユーザーID との取り違えを許さない", async () => {
    vi.stubEnv("OWNER_DISCORD_ID", "user-123");

    expect(await isOwner({ id: "user-123", discordId: "111111111111111111" })).toBe(false);
  });

  it("前後の空白を除去して比較する", async () => {
    vi.stubEnv("OWNER_DISCORD_ID", "  111111111111111111  ");

    expect(await isOwner({ discordId: "111111111111111111" })).toBe(true);
  });
});
