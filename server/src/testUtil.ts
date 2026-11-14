import type { AppContext } from './context.js';
import { Vault } from './crypto/vault.js';
import { openDb } from './db/index.js';
import { dbVaultStore } from './db/vaultStore.js';
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
    allowedOrigins: ['http://localhost:5173'],
  };
}
