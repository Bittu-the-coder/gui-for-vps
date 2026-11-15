import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AppContext } from './context.js';
import { Vault } from './crypto/vault.js';
import { openDb } from './db/index.js';
import { dbVaultStore } from './db/vaultStore.js';
import { AiGateway } from './services/ai/gateway.js';
import { DbService } from './services/dbgui/dbgui.js';
import { JobService } from './services/jobs/jobs.js';
import { RecipeService } from './services/recipes/recipes.js';
import { SftpService } from './services/sftp/sftp.js';
import { Runner } from './services/runner/runner.js';
import { dbHostKeyStore } from './ssh/hostKeys.js';
import { SshPool } from './ssh/pool.js';

/** In-memory DB + cheap-scrypt vault for tests. */
export function testCtx(): AppContext {
  const db = openDb(':memory:');
  const vault = new Vault(dbVaultStore(db), { N: 2 ** 10, r: 8, p: 1 });
  const pool = new SshPool(db, vault, dbHostKeyStore(db));
  const runner = new Runner(db, pool);
  const recipes = new RecipeService(db);
  runner.onSuccess(recipes.recordRun);
  const jobs = new JobService(db, runner, recipes, (id) => pool.status(id) === 'connected');
  const sftp = new SftpService(pool, db);
  runner.onSnapshot((e) => void sftp.prune(e.serverId, e.path).catch(() => {}));
  return {
    db,
    vault,
    pool,
    runner,
    sftp,
    recipes,
    jobs,
    dbs: new DbService(db, vault, pool),
    ai: new AiGateway(db, vault),
    allowedOrigins: ['http://localhost:5173'],
  };
}

/**
 * Integration test files run in parallel, but some share ONE test server whose state they change (the firewall, sshd).
 * This is a lock across processes: `const release = await exclusive('systemd')` in beforeAll, `release()` in afterAll.
 * (A directory is created atomically; a lock older than `staleMs` belongs to a crashed run and is taken over.)
 */
export async function exclusive(name: string, staleMs = 15 * 60_000): Promise<() => void> {
  const { mkdirSync, rmSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = join(tmpdir(), `gfv-test-lock-${name}`);
  for (;;) {
    try {
      mkdirSync(dir);
      return () => rmSync(dir, { recursive: true, force: true });
    } catch {
      try {
        if (Date.now() - statSync(dir).mtimeMs > staleMs)
          rmSync(dir, { recursive: true, force: true });
      } catch {
        /* released meanwhile */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/**
 * The SSH key of the Docker test servers (e2e/keys/id_test, gitignored). Integration tests call this at the top of the
 * file, BEFORE they check whether the containers are running, so it must not throw when the key does not exist (for
 * example on a fresh clone or in CI): they then skip themselves.
 */
export function testKey(): string {
  try {
    return readFileSync(fileURLToPath(new URL('../../e2e/keys/id_test', import.meta.url)), 'utf8');
  } catch {
    return '';
  }
}
