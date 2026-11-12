import type { AppContext } from './context.js';
import { Vault } from './crypto/vault.js';
import { openDb } from './db/index.js';
import { dbVaultStore } from './db/vaultStore.js';
import { dbHostKeyStore } from './ssh/hostKeys.js';
import { SshPool } from './ssh/pool.js';

/** In-memory DB + cheap-scrypt vault for tests. */
export function testCtx(): AppContext {
  const db = openDb(':memory:');
  const vault = new Vault(dbVaultStore(db), { N: 2 ** 10, r: 8, p: 1 });
  const pool = new SshPool(db, vault, dbHostKeyStore(db));
  return { db, vault, pool, allowedOrigins: ['http://localhost:5173'] };
}
