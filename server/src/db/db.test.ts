import { describe, expect, it } from 'vitest';
import { Vault } from '../crypto/vault';
import { openDb } from './index';
import { servers } from './schema';
import { dbVaultStore } from './vaultStore';

const FAST = { N: 2 ** 10, r: 8, p: 1 };

describe('db', () => {
  it('runs migrations and persists vault metadata across Vault instances', async () => {
    const db = openDb(':memory:');
    const a = new Vault(dbVaultStore(db), FAST);
    expect(a.initialized).toBe(false);
    await a.create('pw');

    const b = new Vault(dbVaultStore(db), FAST);
    expect(b.initialized).toBe(true);
    await b.unlock('pw');
    expect(b.unlocked).toBe(true);
  });

  it('stores server credentials only as ciphertext', async () => {
    const db = openDb(':memory:');
    const v = new Vault(dbVaultStore(db), FAST);
    await v.create('pw');
    db.insert(servers)
      .values({
        id: 's1',
        name: 'test',
        host: '127.0.0.1',
        port: 2201,
        username: 'gfv',
        authType: 'password',
        credential: v.encrypt(JSON.stringify({ password: 'topsecret' })),
        createdAt: Date.now(),
      })
      .run();
    const row = db.select().from(servers).get()!;
    expect(row.credential.toString('latin1')).not.toContain('topsecret');
    expect(JSON.parse(v.decrypt(row.credential))).toEqual({ password: 'topsecret' });
  });
});
