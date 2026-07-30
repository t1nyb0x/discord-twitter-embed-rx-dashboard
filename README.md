# TwitterRX Dashboard

Discord Bot（TwitterRX）のギルド設定・チャンネルホワイトリストを管理する Web ダッシュボードです。

## 技術スタック

| カテゴリ       | 技術                                  |
| -------------- | ------------------------------------- |
| フレームワーク | Astro v4（SSR モード + Node adapter） |
| UI             | Preact                                |
| データベース   | SQLite（better-sqlite3）+ Drizzle ORM |
| セッション／KV | Redis（ioredis）                      |
| 認証           | Discord OAuth2（arctic）              |
| 暗号化         | AES-256-GCM（Node.js crypto）         |
| テスト         | Vitest v4                             |
| Lint／Format   | oxlint・oxfmt                         |
| ランタイム     | Node.js 24（Docker: node:24-alpine）  |

## セットアップ

### 1. 依存関係のインストール

`@twitterrx/shared` は GitHub Packages で公開されています。インストール前に `NODE_AUTH_TOKEN` を設定してください。

```bash
export NODE_AUTH_TOKEN=<GitHub Personal Access Token>
npm install
```

### 2. 環境変数の設定

環境変数ファイルは用途に応じて 2 種類に分かれています。

| ファイル   | 用途                                                    | 参照元                 |
| ---------- | ------------------------------------------------------- | ---------------------- |
| `.env.app` | アプリシークレット（コンテナに渡す）                    | `env_file:`            |
| `.env`     | Compose 変数展開専用（`IMAGE_TAG`, `DASHBOARD_DOMAIN`） | Compose が自動読み込み |

#### ローカル開発（`npm run dev`）

```bash
cp .env.app.example .env
```

#### Docker Compose

```bash
cp .env.app.example .env.app
cp .env.compose.example .env
```

#### アプリ変数一覧（`.env.app`）

**必須**

| 変数名                         | 説明                                               |
| ------------------------------ | -------------------------------------------------- |
| `DISCORD_OAUTH2_CLIENT_ID`     | Discord Developer Portal で取得                    |
| `DISCORD_OAUTH2_CLIENT_SECRET` | Discord Developer Portal で取得                    |
| `DISCORD_OAUTH2_REDIRECT_URI`  | `https://yourdomain.com/api/auth/discord/callback` |
| `SESSION_SECRET`               | 32 文字以上。`openssl rand -base64 32` で生成      |
| `ENCRYPTION_SALT`              | 16 文字以上。`openssl rand -base64 32` で生成      |

**オプション**

| 変数名                         | デフォルト値               | 説明                                           |
| ------------------------------ | -------------------------- | ---------------------------------------------- |
| `DATABASE_URL`                 | `file:./data/dashboard.db` | SQLite データベースパス                        |
| `REDIS_URL`                    | `redis://redis:6379`       | Redis 接続 URL（Compose 環境では上書きされる） |
| `OWNER_DISCORD_ID`             | （未設定）                 | Bot の持ち主の Discord ユーザーID。設定するとお知らせ作成ページが使える |
| `ORPHAN_CONFIG_RETENTION_DAYS` | `30`                       | 孤立設定の保持日数                             |
| `AUDIT_LOG_RETENTION_DAYS`     | `90`                       | 監査ログの保持日数                             |

#### Compose 変数一覧（`.env`）

| 変数名             | デフォルト値 | 説明                             |
| ------------------ | ------------ | -------------------------------- |
| `IMAGE_TAG`        | `latest`     | デプロイするイメージタグ         |
| `DASHBOARD_DOMAIN` | —            | nginx-proxy が参照するドメイン名 |

### 3. データベースマイグレーション

```bash
npm run db:generate
npm run db:migrate
```

### 4. 開発サーバーの起動

```bash
npm run dev
```

http://localhost:4321 でアクセスできます。

## npm スクリプト

| コマンド                | 説明                         |
| ----------------------- | ---------------------------- |
| `npm run dev`           | 開発サーバー起動             |
| `npm run build`         | 型チェック + 本番ビルド      |
| `npm run preview`       | ビルド成果物のプレビュー     |
| `npm run test`          | テスト実行（Vitest）         |
| `npm run test:watch`    | テスト監視モード             |
| `npm run test:coverage` | カバレッジ付きテスト実行     |
| `npm run lint`          | Lint 実行（oxlint）          |
| `npm run lint:fix`      | Lint 自動修正                |
| `npm run format`        | フォーマット（oxfmt）        |
| `npm run format:check`  | フォーマットチェック         |
| `npm run db:generate`   | Drizzle マイグレーション生成 |
| `npm run db:migrate`    | マイグレーション適用         |
| `npm run db:studio`     | Drizzle Studio 起動          |

## Docker での実行

### Docker Compose（推奨）

```bash
# 環境変数ファイルを用意
cp .env.app.example .env.app   # アプリシークレットを編集
cp .env.compose.example .env   # NODE_AUTH_TOKEN・IMAGE_TAG・DASHBOARD_DOMAIN を編集

docker compose up -d
```

ソースからビルドする場合（`compose.yml` の `image:` をコメントアウトしたまま使う場合）は、`.env` の `NODE_AUTH_TOKEN` に GitHub Packages の読み取り権限（`read:packages`）を持つ Personal Access Token を設定してください。GHCR の既存イメージを使う場合（`image:` を有効化した場合）は不要です。

### 単体ビルド・起動

```bash
docker build \
  --build-arg NODE_AUTH_TOKEN=<GitHub Personal Access Token> \
  -t twitterrx-dashboard .
docker run -p 4321:4321 \
  -v dashboard_data:/app/data \
  --env-file .env.app \
  twitterrx-dashboard
```

`NODE_AUTH_TOKEN` には GitHub Packages の読み取り権限（`read:packages`）を持つ Personal Access Token を指定してください。

起動時に `scripts/migrate.sh` が自動実行され、データベースマイグレーションが適用されます。

## 機能

- ✅ Discord OAuth2 認証（arctic）
- ✅ CSRF 保護（Redis + timing-safe 検証）
- ✅ レート制限（Lua スクリプトで原子化）
- ✅ トークン暗号化（AES-256-GCM + scrypt 鍵派生）
- ✅ セッション管理（Redis、7 日間 TTL）
- ✅ SQLite データベース（Drizzle ORM）
- ✅ ギルド設定・チャンネルホワイトリスト管理
- ✅ 監査ログ（設定変更の記録・閲覧）
- ✅ Redis 再シード処理（起動時に SQLite → Redis 復元）
- ✅ セキュリティヘッダー（X-Content-Type-Options, X-Frame-Options 等）

## API エンドポイント

| エンドポイント                     | メソッド    | 説明                    |
| ---------------------------------- | ----------- | ----------------------- |
| `/api/auth/discord/login`          | GET         | Discord OAuth2 ログイン |
| `/api/auth/discord/callback`       | GET         | OAuth2 コールバック     |
| `/api/auth/logout`                 | POST        | ログアウト              |
| `/api/guilds`                      | GET         | ギルド一覧取得          |
| `/api/guilds/[guildId]/config`     | GET / PATCH | ギルド設定の取得・更新  |
| `/api/guilds/[guildId]/channels`   | GET         | チャンネル一覧取得      |
| `/api/guilds/[guildId]/audit-logs` | GET         | 監査ログ取得            |

## ページ

| パス                          | 説明                               |
| ----------------------------- | ---------------------------------- |
| `/`                           | ランディングページ（未ログイン時） |
| `/dashboard`                  | ダッシュボード（ギルド選択）       |
| `/dashboard/guilds/[guildId]` | ギルド設定画面                     |
| `/auth/session-expired`       | セッション期限切れ画面             |
