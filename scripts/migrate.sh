#!/bin/sh
# dashboard/scripts/migrate.sh

echo "Running database migrations..."

# データディレクトリを確実に作成
mkdir -p ./data

# データベースファイルが存在して、既にマイグレーションテーブルが存在するか確認
if [ -f "./data/dashboard.db" ]; then
  # sqlite3でマイグレーションテーブルの存在を確認
  if command -v sqlite3 > /dev/null 2>&1; then
    TABLE_EXISTS=$(sqlite3 ./data/dashboard.db "SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations';" 2>/dev/null || echo "")
    if [ -n "$TABLE_EXISTS" ]; then
      echo "Database and migration tracking table already exist, attempting migration anyway..."
    fi
  fi
fi

# Drizzle ORMのマイグレーションを実行
# エラーが発生した場合、「table already exists」エラーであれば無視
if npm run db:migrate 2>&1 | tee /tmp/migrate.log; then
  echo "Migrations completed successfully"
else
  # エラーログに「already exists」が含まれている場合は正常とみなす
  if grep -q "already exists" /tmp/migrate.log; then
    echo "Database tables already exist, skipping migrations"
  else
    echo "Migration failed with unexpected error"
    exit 1
  fi
fi
