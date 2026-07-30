// リバースプロキシ越しでも正しく機能する CSRF（Origin）チェック。
//
// Astro 標準の security.checkOrigin は無効化している（astro.config.mjs 参照）。
// 標準実装は nginx-proxy 等のリバースプロキシ背後では Host / X-Forwarded-* を
// 信用せず、url.origin をコンテナが実際に受けた内部アドレス http://localhost:4321 に
// 解決する。ブラウザは公開 URL（https://<ドメイン>）を Origin として送るため両者が
// 一致せず、正当な POST まで 403 にしてしまう。allowedDomains でドメインを登録すれば
// 直せるが、その値はビルド時にマニフェストへ焼き込まれるため、デプロイ先ドメインを
// CI が知らない GHCR 公開イメージでは使えない。そこで実行時にプロキシの
// Host / X-Forwarded-* から公開 Origin を組み立てて検証する。

// CSRF（Origin）チェック対象外の安全なメソッド
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// フォーム送信とみなす Content-Type（Astro 標準の checkOrigin と同一基準）
const FORM_LIKE_CONTENT_TYPES = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
];

function isFormLikeContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return FORM_LIKE_CONTENT_TYPES.some((type) => lower.includes(type));
}

// 複数値ヘッダー（"a, b" 形式）の先頭値を取り出す
function firstHeaderValue(value: string | null): string | undefined {
  if (!value) return undefined;
  return value.split(",")[0]?.trim() || undefined;
}

/**
 * クロスサイトのフォーム送信かどうかを判定する。
 *
 * 対象は Astro 標準の checkOrigin と同じく「安全でないメソッド」かつ
 * 「フォーム系 Content-Type、もしくは Content-Type なし」のリクエストのみ。
 * application/json の fetch はブラウザの同一オリジンポリシーで守られるため対象外。
 *
 * 許可する Origin は次の 2 系統:
 *   - url.origin（ローカル開発など、プロキシを介さず url.origin が正しいケース）
 *   - プロキシが渡す実際の公開ホスト（X-Forwarded-Host / Host と X-Forwarded-Proto）
 *
 * @returns クロスサイトのフォーム送信として拒否すべきなら true
 */
export function isCrossSiteFormRequest(request: Request, url: URL): boolean {
  if (SAFE_METHODS.has(request.method)) return false;

  const contentType = request.headers.get("content-type");
  const needsCheck = contentType === null || isFormLikeContentType(contentType);
  if (!needsCheck) return false;

  const origin = request.headers.get("origin");
  // フォーム系 POST に Origin が無いのはクロスサイト扱い（Astro 標準と同じ）
  if (!origin) return true;

  const allowedOrigins = new Set<string>();
  // 直接アクセス（ローカル開発など、url.origin が正しいケース）
  allowedOrigins.add(url.origin);
  // プロキシが保持する実際の公開ホスト（nginx-proxy は Host をそのまま透過する）
  const forwardedHost =
    firstHeaderValue(request.headers.get("x-forwarded-host")) ?? request.headers.get("host");
  if (forwardedHost) {
    const forwardedProto =
      firstHeaderValue(request.headers.get("x-forwarded-proto")) ?? url.protocol.replace(/:$/, "");
    allowedOrigins.add(`${forwardedProto}://${forwardedHost}`);
  }

  return !allowedOrigins.has(origin);
}
