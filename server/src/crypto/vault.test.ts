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

describe('Vault.changePassword', () => {
  it('re-encrypts with a new key, in the callback, and swaps keys', async () => {
    const store = memStore();
    const v = new Vault(store, FAST);
    await v.create('old-password');
    const blob = v.encrypt('secret credential');
    let migrated: Buffer | undefined;
    await v.changePassword(
      'old-password',
      'new-password',
      (dec, enc) => {
        migrated = enc(dec(blob));
      },
      (fn) => fn(),
    );
    expect(v.decrypt(migrated!)).toBe('secret credential'); // live key is already the new one
    const again = new Vault(store, FAST);
    await expect(again.unlock('old-password')).rejects.toMatchObject({ code: 'wrong_password' });
    await again.unlock('new-password');
    expect(again.decrypt(migrated!)).toBe('secret credential');
  });
  it('a wrong old password changes nothing', async () => {
    const store = memStore();
    const v = new Vault(store, FAST);
    await v.create('old-password');
    const before = store.meta;
    await expect(
      v.changePassword(
        'nope',
        'x'.repeat(8),
        () => {},
        (fn) => fn(),
      ),
    ).rejects.toMatchObject({ code: 'wrong_password' });
    expect(store.meta).toBe(before);
  });
  it('if the transaction throws, the old password still works', async () => {
    const store = memStore();
    const v = new Vault(store, FAST);
    await v.create('old-password');
    const before = store.meta;
    await expect(
      v.changePassword(
        'old-password',
        'new-password',
        () => {},
        () => {
          throw new Error('disk full');
        },
      ),
    ).rejects.toThrow('disk full');
    expect(store.meta).toBe(before);
    await new Vault(store, FAST).unlock('old-password');
  });
});
