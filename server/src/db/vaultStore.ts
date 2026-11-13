import { eq } from 'drizzle-orm';
import type { VaultMetaStore } from '../crypto/vault.js';
import type { Db } from './index.js';
import { vaultMeta } from './schema.js';

export function dbVaultStore(db: Db): VaultMetaStore {
  return {
    load() {
      const row = db.select().from(vaultMeta).where(eq(vaultMeta.id, 1)).get();
      return row && { salt: row.salt, params: row.params, canary: row.canary };
    },
    save(meta) {
      // Upsert: the first save creates the row, changing the master password replaces it.
      db.insert(vaultMeta)
        .values({ id: 1, ...meta })
        .onConflictDoUpdate({ target: vaultMeta.id, set: meta })
        .run();
    },
  };
}
