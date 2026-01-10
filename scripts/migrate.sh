#!/bin/sh
# dashboard/scripts/migrate.sh

set -e

echo "Running database migrations..."

# データディレクトリを確実に作成
mkdir -p ./data

# Drizzle ORMのマイグレーションを実行
npm run db:migrate

echo "Migrations completed successfully"
