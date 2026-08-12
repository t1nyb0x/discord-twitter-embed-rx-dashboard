import { fileURLToPath } from "node:url";

import node from "@astrojs/node";
import preact from "@astrojs/preact";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: node({
    mode: "standalone",
  }),
  integrations: [preact()],
  security: {
    // Astro 標準の Origin チェックは、リバースプロキシ（nginx-proxy 等）越しでは
    // 正しく機能しない。Astro は Host / X-Forwarded-* を（allowedDomains を明示登録
    // しない限り）信用せず、url.origin をコンテナが実際に受けた内部アドレス
    // http://localhost:4321 に解決する。一方ブラウザは公開 URL（https://<ドメイン>）を
    // Origin として送るため両者が一致せず、正当な POST まで 403 で拒否されてしまう。
    // allowedDomains はビルド時にマニフェストへ焼き込まれるため、デプロイ先ドメインを
    // CI が知らない GHCR 公開イメージでは使えない。そのため標準チェックは無効化し、
    // src/middleware.ts で実行時にプロキシの Host / X-Forwarded-* から公開 Origin を
    // 組み立てて検証する。
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
