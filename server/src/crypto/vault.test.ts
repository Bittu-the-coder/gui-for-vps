import { describe, expect, it } from 'vitest';
import { Vault, VaultError, type VaultMeta, type VaultMetaStore } from './vault';

// Cheap scrypt so tests are fast; production uses DEFAULT_SCRYPT.
const FAST = { N: 2 ** 10, r: 8, p: 1 };

function memStore(): VaultMetaStore & { meta?: VaultMeta } {
  const s: VaultMetaStore & { meta?: VaultMeta } = {
    load: () => s.meta,
    save: (m) => {
      s.meta = m;
    },
  };
  return s;
}

describe('Vault', () => {
  it('encrypts and decrypts a round trip', async () => {
    const v = new Vault(memStore(), FAST);
    await v.create('hunter2');
    const blob = v.encrypt('ssh-private-key-data');
    expect(blob.toString('utf8')).not.toContain('ssh-private');
    expect(v.decrypt(blob)).toBe('ssh-private-key-data');
  });

  it('uses a fresh IV so equal plaintexts encrypt differently', async () => {
    const v = new Vault(memStore(), FAST);
    await v.create('pw');
    expect(v.encrypt('same').equals(v.encrypt('same'))).toBe(false);
  });

  it('unlocks with the right password in a new instance', async () => {
    const store = memStore();
    const a = new Vault(store, FAST);
    await a.create('correct horse');
    const blob = a.encrypt('secret');

    const b = new Vault(store, FAST);
    expect(b.unlocked).toBe(false);
    await b.unlock('correct horse');
    expect(b.decrypt(blob)).toBe('secret');
  });

  it('rejects a wrong password and stays locked', async () => {
    const store = memStore();
    await new Vault(store, FAST).create('right');
    const b = new Vault(store, FAST);
    await expect(b.unlock('wrong')).rejects.toMatchObject({ code: 'wrong_password' });
    expect(b.unlocked).toBe(false);
  });

  it('detects tampered ciphertext', async () => {
    const v = new Vault(memStore(), FAST);
    await v.create('pw');
    const blob = v.encrypt('secret');
    blob[blob.length - 1]! ^= 0xff;
    expect(() => v.decrypt(blob)).toThrow();
  });

  it('refuses to encrypt or decrypt while locked', async () => {
    const v = new Vault(memStore(), FAST);
    await v.create('pw');
    const blob = v.encrypt('x');
    v.lock();
    expect(() => v.encrypt('x')).toThrow(VaultError);
    expect(() => v.decrypt(blob)).toThrow(VaultError);
  });

  it('cannot be created twice', async () => {
    const v = new Vault(memStore(), FAST);
    await v.create('pw');
    await expect(v.create('other')).rejects.toMatchObject({ code: 'already_initialized' });
  });

  it('never stores the password or key in the metadata', async () => {
    const store = memStore();
    await new Vault(store, FAST).create('my-master-password');
    expect(JSON.stringify(store.meta)).not.toContain('my-master-password');
  });
});
