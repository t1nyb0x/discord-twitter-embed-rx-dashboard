import { describe, it, expect } from "vitest";

import { isCrossSiteFormRequest } from "@/lib/origin-check";

// テスト用の Request を組み立てるヘルパー
function makeRequest(method: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:4321/api/auth/logout", {
    method,
    headers,
  });
}

const LOCAL_URL = new URL("http://localhost:4321/api/auth/logout");
// 本番: nginx-proxy 背後では url.origin が内部アドレス http://localhost:4321 に解決される
const PROD_URL = new URL("http://localhost:4321/api/auth/logout");

describe("isCrossSiteFormRequest", () => {
  describe("安全なメソッドは常に許可", () => {
    it.each(["GET", "HEAD", "OPTIONS"])("%s は false", (method) => {
      const req = makeRequest(method, { origin: "https://evil.example" });
      expect(isCrossSiteFormRequest(req, LOCAL_URL)).toBe(false);
    });
  });

  describe("Content-Type による対象判定", () => {
    it("application/json の POST は対象外（false）", () => {
      const req = makeRequest("POST", {
        "content-type": "application/json",
        origin: "https://evil.example",
      });
      expect(isCrossSiteFormRequest(req, LOCAL_URL)).toBe(false);
    });

    it.each(["application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "text/plain"])(
      "フォーム系 Content-Type %s は対象",
      (contentType) => {
        const req = makeRequest("POST", {
          "content-type": contentType,
          origin: "https://evil.example",
        });
        expect(isCrossSiteFormRequest(req, LOCAL_URL)).toBe(true);
      },
    );

    it("Content-Type なしの POST も対象", () => {
      const req = makeRequest("POST", { origin: "https://evil.example" });
      expect(isCrossSiteFormRequest(req, LOCAL_URL)).toBe(true);
    });
  });

  describe("Origin の照合", () => {
    it("Origin ヘッダーが無いフォーム POST は拒否（true）", () => {
      const req = makeRequest("POST", {
        "content-type": "application/x-www-form-urlencoded",
      });
      expect(isCrossSiteFormRequest(req, LOCAL_URL)).toBe(true);
    });

    it("ローカル: Origin が url.origin と一致すれば許可（false）", () => {
      const req = makeRequest("POST", {
        "content-type": "application/x-www-form-urlencoded",
        origin: "http://localhost:4321",
        host: "localhost:4321",
      });
      expect(isCrossSiteFormRequest(req, LOCAL_URL)).toBe(false);
    });

    it("本番: プロキシの Host + X-Forwarded-Proto から組み立てた Origin と一致すれば許可", () => {
      const req = makeRequest("POST", {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://twitterrx-dashboard.t1nyb0x.cloud",
        host: "twitterrx-dashboard.t1nyb0x.cloud",
        "x-forwarded-proto": "https",
      });
      expect(isCrossSiteFormRequest(req, PROD_URL)).toBe(false);
    });

    it("本番: X-Forwarded-Host を優先して照合できる", () => {
      const req = makeRequest("POST", {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://twitterrx-dashboard.t1nyb0x.cloud",
        host: "internal:4321",
        "x-forwarded-host": "twitterrx-dashboard.t1nyb0x.cloud",
        "x-forwarded-proto": "https",
      });
      expect(isCrossSiteFormRequest(req, PROD_URL)).toBe(false);
    });

    it("本番: 攻撃者ドメインからのクロスサイト送信は拒否（true）", () => {
      const req = makeRequest("POST", {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://evil.example",
        host: "twitterrx-dashboard.t1nyb0x.cloud",
        "x-forwarded-proto": "https",
      });
      expect(isCrossSiteFormRequest(req, PROD_URL)).toBe(true);
    });

    it("プロトコル不一致（http Origin vs https 公開）は拒否", () => {
      const req = makeRequest("POST", {
        "content-type": "application/x-www-form-urlencoded",
        origin: "http://twitterrx-dashboard.t1nyb0x.cloud",
        host: "twitterrx-dashboard.t1nyb0x.cloud",
        "x-forwarded-proto": "https",
      });
      expect(isCrossSiteFormRequest(req, PROD_URL)).toBe(true);
    });

    it("複数値ヘッダーは先頭値を採用する", () => {
      const req = makeRequest("POST", {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://twitterrx-dashboard.t1nyb0x.cloud",
        "x-forwarded-host": "twitterrx-dashboard.t1nyb0x.cloud, internal",
        "x-forwarded-proto": "https, http",
      });
      expect(isCrossSiteFormRequest(req, PROD_URL)).toBe(false);
    });
  });
});
