import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Db = ReturnType<typeof openDb>;

// From source (server/src/db) the migrations are two levels up; in the published bundle
// (dist/cli.js) they sit next to dist/.
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS =
  process.env.GFV_MIGRATIONS ??
  [resolve(HERE, '../drizzle'), resolve(HERE, '../../drizzle')].find((p) => existsSync(p)) ??
  resolve(HERE, '../../drizzle');

/** GFV_HOME overrides the data dir (used by tests). Default: ~/.gfv */
export function dataDir(): string {
  return process.env.GFV_HOME ?? join(homedir(), '.gfv');
}

/** Pass ':memory:' for tests. Migrations run automatically on open. */
export function openDb(file: string = join(dataDir(), 'gfv.db')) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const sqlite = new Database(file);
  // The file holds encrypted credentials and host keys: owner-only.
  if (file !== ':memory:') chmodSync(file, 0o600);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}
