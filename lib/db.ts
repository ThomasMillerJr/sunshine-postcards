import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";

const DB_PATH = path.join(process.cwd(), "sunshine-postcards.db");

// Lazy singleton — avoids crashing next build (better-sqlite3 is native)
let _sqlite: InstanceType<typeof Database> | null = null;
let _db: BetterSQLite3Database<typeof schema> | null = null;

function getConnection() {
  if (!_sqlite) {
    _sqlite = new Database(DB_PATH);
    _sqlite.pragma("journal_mode = WAL");
    _sqlite.pragma("foreign_keys = ON");
  }
  return _sqlite;
}

export function getDb() {
  if (!_db) {
    _db = drizzle(getConnection(), { schema });
  }
  return _db;
}
