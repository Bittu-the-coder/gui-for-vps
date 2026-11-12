import { buildApp } from './app.js';
import { createToken } from './auth.js';
import { Vault } from './crypto/vault.js';
import { openDb } from './db/index.js';
import { dbVaultStore } from './db/vaultStore.js';
import { Runner } from './services/runner/runner.js';
import { dbHostKeyStore } from './ssh/hostKeys.js';
import { SshPool } from './ssh/pool.js';

const HOST = '127.0.0.1'; // never 0.0.0.0 — local mode only
const PORT = Number(process.env.GFV_PORT ?? 4310);
const WEB_DEV_PORT = 5173;

const db = openDb();
const vault = new Vault(dbVaultStore(db));
const pool = new SshPool(db, vault, dbHostKeyStore(db));
const allowedOrigins = [PORT, WEB_DEV_PORT].flatMap((p) => [
  `http://127.0.0.1:${p}`,
  `http://localhost:${p}`,
]);

const app = await buildApp(createToken(), {
  db,
  vault,
  pool,
  runner: new Runner(db, pool),
  allowedOrigins,
});
await app.listen({ host: HOST, port: PORT });
