FROM node:24-alpine AS builder

# better-sqlite3 のビルドに必要なツールをインストール
RUN apk add --no-cache python3 make g++

WORKDIR /app

# workspace のルート設定をコピー
COPY package.json package-lock.json ./

# packages/shared をコピーしてビルド
COPY packages ./packages
RUN npm ci --workspace=@twitterrx/shared
RUN npm run build --workspace=@twitterrx/shared

# Dashboard のソースをコピー
COPY dashboard ./dashboard
RUN npm ci --workspace=@twitterrx/dashboard
RUN npm run db:generate --workspace=@twitterrx/dashboard
RUN npm run build --workspace=@twitterrx/dashboard

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# 非 root ユーザーで実行
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 astro

# better-sqlite3 のビルドツールを一時的にインストール
RUN apk add --no-cache python3 make g++

USER astro

# workspace 設定をコピー
COPY --from=builder --chown=astro:nodejs /app/package.json ./
COPY --from=builder --chown=astro:nodejs /app/package-lock.json ./

# packages/shared のビルド成果物をコピー
COPY --from=builder --chown=astro:nodejs /app/packages ./packages

# Dashboard の package.json をコピー
COPY --from=builder --chown=astro:nodejs /app/dashboard/package.json ./dashboard/

# production 依存関係のみインストール（better-sqlite3 を runner 環境で再ビルド）
# drizzle-kit はマイグレーション実行に必要なので含める
USER root
RUN npm ci --workspace=@twitterrx/dashboard --include=dev --omit=optional
USER astro

# Dashboard のビルド成果物をコピー
COPY --from=builder --chown=astro:nodejs /app/dashboard/dist ./dashboard/dist

# マイグレーション実行スクリプト
COPY --from=builder --chown=astro:nodejs /app/dashboard/scripts ./dashboard/scripts

# Drizzle 設定とマイグレーションファイル
COPY --from=builder --chown=astro:nodejs /app/dashboard/drizzle.config.ts ./dashboard/
COPY --from=builder --chown=astro:nodejs /app/dashboard/drizzle ./dashboard/drizzle

# データディレクトリを作成（astro ユーザーで）
RUN mkdir -p /app/dashboard/data

# 作業ディレクトリを dashboard に変更
WORKDIR /app/dashboard

VOLUME /app/dashboard/data

EXPOSE 4321

# 起動時にマイグレーションを実行
CMD ["sh", "-c", "./scripts/migrate.sh && node dist/server/entry.mjs"]
