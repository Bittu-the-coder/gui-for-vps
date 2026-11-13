import type { Vault } from './crypto/vault.js';
import type { Db } from './db/index.js';
import type { RecipeService } from './services/recipes/recipes.js';
import type { SftpService } from './services/sftp/sftp.js';
import type { Runner } from './services/runner/runner.js';
import type { SshPool } from './ssh/pool.js';

/** Shared dependencies handed to every route module. */
export interface AppContext {
  db: Db;
  vault: Vault;
  pool: SshPool;
  runner: Runner;
  sftp: SftpService;
  recipes: RecipeService;
  /** Browser origins allowed to open the WebSocket. */
  allowedOrigins: string[];
}
