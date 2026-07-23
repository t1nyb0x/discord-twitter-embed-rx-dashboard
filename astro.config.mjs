import node from "@astrojs/node";
import preact from "@astrojs/preact";
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: node({
    mode: "standalone",
  }),
  integrations: [preact()],
  security: {
    // Astro 標準の Origin チェックは、リバースプロキシ（nginx-proxy 等）越しでは
    // url.origin を http://localhost:4321 として誤計算し、ブラウザの Origin と
    // 不一致になって POST を 403 で拒否する。allowedDomains はビルド時にマニフェストへ
    // 焼き込まれるため、GHCR 公開イメージ（デプロイ先ドメインを CI が知らない）では
    // 使えない。そのため標準チェックは無効化し、src/middleware.ts で実行時に
    // プロキシの Host / X-Forwarded-* から正しい Origin を検証する。
    checkOrigin: false,
  },
  vite: {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  },
  server: {
    port: 4321,
    host: true,
  },
});
