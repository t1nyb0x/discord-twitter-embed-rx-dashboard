import { defineConfig } from "vitest/config";

// E2E テスト専用の設定。
// 起動済みの Dashboard に HTTP で叩くだけなので src を import せず、
// ユニットテスト側（vitest.config.ts）のようなダミー環境変数もエイリアスも要らない。
// ユニットテストと混ざらないよう include を tests/e2e に限定している。
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    // ネットワーク越しの検証なので既定の 5 秒より余裕を持たせる
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
