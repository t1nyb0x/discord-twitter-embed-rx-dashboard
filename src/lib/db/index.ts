import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL || "file:./data/dashboard.db";

// URLからファイルパスを抽出（file:プレフィックスを除去）
const dbPath = DATABASE_URL.replace(/^file:/, "");

let _db: BetterSQLite3Database<typeof schema> | null = null;

// データベース接続の遅延初期化
export const db = new Proxy({} as BetterSQLite3Database<typeof schema>, {
  get(_, prop) {
    if (!_db) {
      const sqlite = new Database(dbPath);
      _db = drizzle(sqlite, { schema });
    }
    return (_db as any)[prop];
  },
});
