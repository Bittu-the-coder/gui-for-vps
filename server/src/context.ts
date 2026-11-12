import type { Vault } from './crypto/vault.js';
import type { Db } from './db/index.js';
import type { SshPool } from './ssh/pool.js';

/** Shared dependencies handed to every route module. */
export interface AppContext {
  db: Db;
  vault: Vault;
  pool: SshPool;
  /** Browser origins allowed to open the WebSocket. */
  allowedOrigins: string[];
}
