FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS builder

# better-sqlite3 のビルドに必要なツールをインストール
# hadolint ignore=DL3018
RUN apk add --no-cache python3 make g++

WORKDIR /app

ARG NODE_AUTH_TOKEN

# package.json をコピー（この層は package.json が変わらない限りキャッシュされる）
COPY package.json package-lock.json ./

# GitHub Packages 認証設定（インストール後に削除）
# hadolint ignore=DL3016
RUN echo "@rx-twitter:registry=https://npm.pkg.github.com" >> .npmrc && \
    echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" >> .npmrc && \
    npm ci && \
    rm -f .npmrc

# ソースをコピーしてビルド
COPY . .
RUN npm run build

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runner

WORKDIR /app
ENV NODE_ENV=production

# 非 root ユーザーで実行
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 astro

# better-sqlite3 のビルドツールを一時的にインストールし、ビルド後に削除
# hadolint ignore=DL3018
RUN apk add --no-cache --virtual .build-deps python3 make g++

ARG NODE_AUTH_TOKEN

USER root
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./

# drizzle-kit はマイグレーション実行に必要なので含める
# hadolint ignore=DL3016
RUN echo "@rx-twitter:registry=https://npm.pkg.github.com" >> .npmrc && \
    echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" >> .npmrc && \
    npm install --include=dev --omit=optional && \
    rm -f .npmrc && \
    apk del .build-deps

USER astro

# ビルド成果物をコピー
COPY --from=builder --chown=astro:nodejs /app/dist ./dist

# マイグレーション実行スクリプト
COPY --from=builder --chown=astro:nodejs /app/scripts ./scripts

# Drizzle 設定とマイグレーションファイル
COPY --from=builder --chown=astro:nodejs /app/drizzle.config.ts ./
COPY --from=builder --chown=astro:nodejs /app/drizzle ./drizzle

# データディレクトリを作成して astro ユーザーに所有権を付与（root で実行）
USER root
RUN mkdir -p /app/data && chown astro:nodejs /app/data
USER astro

VOLUME /app/data

# 起動ラッパースクリプト
COPY --from=builder --chown=astro:nodejs /app/server-start.mjs ./

EXPOSE 4321

# 起動時にマイグレーションを実行
CMD ["sh", "-c", "./scripts/migrate.sh && node server-start.mjs"]
