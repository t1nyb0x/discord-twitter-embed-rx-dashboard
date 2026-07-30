import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
  exists: vi.fn(),
};
vi.mock("@/lib/redis", () => ({
  redis: mockRedis,
}));

/**
 * drizzle のチェーンを最小限に模したモック。
 * select().from(table) は awaitable、where() は awaitable かつ limit() を持つ。
 */
const dbState = {
  guildConfigs: [] as Record<string, unknown>[],
  whitelist: [] as Record<string, unknown>[],
};

const mockInsertValues = vi.fn();

vi.mock("@/lib/db", () => {
  const thenable = <T>(value: T, extra: Record<string, unknown> = {}) => ({
    ...extra,
    then: (resolve: (v: T) => unknown) => Promise.resolve(value).then(resolve),
  });

  return {
    db: {
      select: () => ({
        from: (table: unknown) => {
          const isWhitelist =
            typeof table === "object" && table !== null && "channelId" in (table as object);
          const rows = isWhitelist ? dbState.whitelist : dbState.guildConfigs;
          return thenable(rows, {
            where: () => thenable(rows, { limit: () => Promise.resolve(rows) }),
          });
        },
      }),
      insert: () => ({ values: (...args: unknown[]) => mockInsertValues(...args) }),
    },
  };
});

const GUILD_ID = "123456789012345678";
const CONFIG_KEY = `app:guild:${GUILD_ID}:config`;

function redisConfig(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    guildId: GUILD_ID,
    allowAllChannels: false,
    whitelistedChannelIds: ["111111111111111111"],
    version: 3,
    updatedAt: "2026-07-30T00:00:00.000Z",
    ...overrides,
  });
}

describe("reconcileConfigs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    dbState.guildConfigs = [
      {
        guildId: GUILD_ID,
        allowAllChannels: false,
        version: 3,
        updatedAt: "2026-07-30T00:00:00.000Z",
        maxUrlsPerMessage: null,
        announceTargetMode: null,
        announceTargetChannelId: null,
      },
    ];
    dbState.whitelist = [{ guildId: GUILD_ID, channelId: "111111111111111111" }];

    mockRedis.set.mockResolvedValue("OK");
    mockInsertValues.mockResolvedValue(undefined);
  });

  async function reconcile(guildIds: string[] = [GUILD_ID]) {
    const { reconcileConfigs } = await import("@/lib/reseed");
    return reconcileConfigs(guildIds);
  }

  it("Redis と SQLite の version が一致していれば書き込まない", async () => {
    mockRedis.get.mockResolvedValue(redisConfig({ version: 3 }));

    await reconcile();

    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("Redis の version が古い場合は再シードする", async () => {
    mockRedis.get.mockResolvedValue(redisConfig({ version: 2 }));

    await reconcile();

    expect(mockRedis.set).toHaveBeenCalledTimes(1);
    const [key, value] = mockRedis.set.mock.calls[0];
    expect(key).toBe(CONFIG_KEY);
    expect(JSON.parse(value).version).toBe(3);
  });

  it("Redis キーが存在しない場合は再シードする", async () => {
    mockRedis.get.mockResolvedValue(null);

    await reconcile();

    expect(mockRedis.set).toHaveBeenCalledTimes(1);
  });

  it("Redis の値が壊れている場合は再シードする", async () => {
    mockRedis.get.mockResolvedValue("{ broken json");

    await reconcile();

    expect(mockRedis.set).toHaveBeenCalledTimes(1);
  });

  it("Redis の値に version が無い場合は再シードする", async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ guildId: GUILD_ID }));

    await reconcile();

    expect(mockRedis.set).toHaveBeenCalledTimes(1);
  });

  it("Bot が読む whitelistedChannelIds の形で書き込む", async () => {
    mockRedis.get.mockResolvedValue(null);

    await reconcile();

    const written = JSON.parse(mockRedis.set.mock.calls[0][1]);
    expect(written.whitelistedChannelIds).toEqual(["111111111111111111"]);
    expect(written).not.toHaveProperty("whitelist");
  });

  it("SQLite に設定が無いギルドはデフォルトを作成する", async () => {
    dbState.guildConfigs = [];
    mockRedis.get.mockResolvedValue(null);

    await reconcile();

    expect(mockRedis.set).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockRedis.set.mock.calls[0][1]);
    expect(written.allowAllChannels).toBe(true);
    expect(written.whitelistedChannelIds).toEqual([]);
    expect(written).not.toHaveProperty("whitelist");
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
  });

  it("お知らせ配信先が設定されていれば含めて書き込む", async () => {
    dbState.guildConfigs[0].announceTargetMode = "channel";
    dbState.guildConfigs[0].announceTargetChannelId = "333333333333333333";
    mockRedis.get.mockResolvedValue(null);

    await reconcile();

    const written = JSON.parse(mockRedis.set.mock.calls[0][1]);
    expect(written.announceTarget).toEqual({
      mode: "channel",
      channelId: "333333333333333333",
    });
  });

  it("お知らせ配信先が未設定なら書き込まない", async () => {
    mockRedis.get.mockResolvedValue(null);

    await reconcile();

    const written = JSON.parse(mockRedis.set.mock.calls[0][1]);
    expect(written).not.toHaveProperty("announceTarget");
  });
});

describe("isRedisConfigStale", () => {
  async function isStale(raw: string | null, sqliteVersion: number) {
    const { isRedisConfigStale } = await import("@/lib/reseed");
    return isRedisConfigStale(raw, sqliteVersion);
  }

  it("値が無ければ古いとみなす", async () => {
    expect(await isStale(null, 1)).toBe(true);
  });

  it("空文字も古いとみなす", async () => {
    expect(await isStale("", 1)).toBe(true);
  });

  it("JSON として壊れていれば古いとみなす", async () => {
    expect(await isStale("{ broken", 1)).toBe(true);
  });

  it("version が無ければ古いとみなす", async () => {
    expect(await isStale(JSON.stringify({ guildId: "1" }), 1)).toBe(true);
  });

  it("version が数値でなければ古いとみなす", async () => {
    expect(await isStale(JSON.stringify({ version: "3" }), 3)).toBe(true);
  });

  it("version が一致していれば古くない", async () => {
    expect(await isStale(JSON.stringify({ version: 3 }), 3)).toBe(false);
  });

  it("Redis の version が小さければ古い", async () => {
    expect(await isStale(JSON.stringify({ version: 2 }), 3)).toBe(true);
  });

  it("Redis の version が大きい場合も乖離として扱う", async () => {
    expect(await isStale(JSON.stringify({ version: 4 }), 3)).toBe(true);
  });

  it("JSON の null を古いとみなす", async () => {
    expect(await isStale("null", 1)).toBe(true);
  });
});
