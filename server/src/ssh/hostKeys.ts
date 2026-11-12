import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { knownHosts } from '../db/schema.js';

/** OpenSSH-style fingerprint: "SHA256:" + unpadded base64 of sha256(raw key blob). */
export function fingerprint(key: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
}

/** The raw host key blob starts with a length-prefixed type string, e.g. "ssh-ed25519". */
export function keyTypeOf(key: Buffer): string {
  const len = key.readUInt32BE(0);
  return key.subarray(4, 4 + len).toString('ascii');
}

export interface StoredHostKey {
  keyType: string;
  fingerprint: string;
}

/** Trust-on-first-use storage: one trusted key per server. */
export interface HostKeyStore {
  get(serverId: string): StoredHostKey | undefined;
  save(serverId: string, key: StoredHostKey): void;
}

export function dbHostKeyStore(db: Db): HostKeyStore {
  return {
    get(serverId) {
      const r = db.select().from(knownHosts).where(eq(knownHosts.serverId, serverId)).get();
      return r && { keyType: r.keyType, fingerprint: r.fingerprint };
    },
    save(serverId, key) {
      db.insert(knownHosts)
        .values({ serverId, ...key, firstSeen: Date.now() })
        .onConflictDoUpdate({
          target: knownHosts.serverId,
          set: { keyType: key.keyType, fingerprint: key.fingerprint, firstSeen: Date.now() },
        })
        .run();
    },
  };
}
