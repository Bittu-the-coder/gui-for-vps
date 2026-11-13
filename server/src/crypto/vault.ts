import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

/**
 * The vault turns a master password into an AES-256 key (via scrypt) and uses it
 * to encrypt SSH credentials. The password and key are NEVER written to disk —
 * only the salt, the scrypt params, and an encrypted "canary" used to check that
 * a password is correct.
 */

export interface ScryptParams {
  N: number; // CPU/memory cost
  r: number;
  p: number;
}

export const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 15, r: 8, p: 1 };

export interface VaultMeta {
  salt: string; // base64
  params: ScryptParams;
  canary: string; // base64 of encrypt(CANARY_PLAINTEXT)
}

/** Where the vault persists its (non-secret) metadata. Implemented by the DB layer. */
export interface VaultMetaStore {
  load(): VaultMeta | undefined;
  save(meta: VaultMeta): void;
}

const CANARY_PLAINTEXT = 'gfv-vault-canary-v1';
const IV_LEN = 12;
const TAG_LEN = 16;

export class VaultError extends Error {
  constructor(
    public readonly code:
      'locked' | 'wrong_password' | 'already_initialized' | 'not_initialized' | 'corrupt',
    message: string,
  ) {
    super(message);
  }
}

function deriveKey(password: string, salt: Buffer, p: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem must exceed 128 * N * r bytes or Node refuses to run.
    scrypt(password, salt, 32, { N: p.N, r: p.r, p: p.p, maxmem: 256 * p.N * p.r }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Blob layout: iv (12) | auth tag (16) | ciphertext. A fresh random IV every time. */
export function encryptWithKey(key: Buffer, plaintext: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptWithKey(key: Buffer, blob: Buffer): string {
  if (blob.length < IV_LEN + TAG_LEN) throw new VaultError('corrupt', 'ciphertext too short');
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  // GCM verifies integrity here: tampering or a wrong key throws.
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export class Vault {
  private key: Buffer | null = null;

  constructor(
    private readonly store: VaultMetaStore,
    private readonly scryptParams: ScryptParams = DEFAULT_SCRYPT,
  ) {}

  get initialized(): boolean {
    return this.store.load() !== undefined;
  }

  get unlocked(): boolean {
    return this.key !== null;
  }

  /** First run: pick a master password. Leaves the vault unlocked. */
  async create(password: string): Promise<void> {
    if (this.initialized) throw new VaultError('already_initialized', 'vault already exists');
    const salt = randomBytes(16);
    const key = await deriveKey(password, salt, this.scryptParams);
    this.store.save({
      salt: salt.toString('base64'),
      params: this.scryptParams,
      canary: encryptWithKey(key, CANARY_PLAINTEXT).toString('base64'),
    });
    this.key = key;
  }

  /** Derives the key for `password` and checks it against the canary. Throws wrong_password. */
  private async verify(password: string): Promise<Buffer> {
    const meta = this.store.load();
    if (!meta) throw new VaultError('not_initialized', 'vault not created yet');
    const key = await deriveKey(password, Buffer.from(meta.salt, 'base64'), meta.params);
    let ok: boolean;
    try {
      // GCM authentication fails (throws) when the derived key is wrong.
      const plain = decryptWithKey(key, Buffer.from(meta.canary, 'base64'));
      ok =
        plain.length === CANARY_PLAINTEXT.length &&
        timingSafeEqual(Buffer.from(plain), Buffer.from(CANARY_PLAINTEXT));
    } catch {
      ok = false;
    }
    if (!ok) throw new VaultError('wrong_password', 'wrong master password');
    return key;
  }

  async unlock(password: string): Promise<void> {
    this.key = await this.verify(password);
  }

  /**
   * Switch to a new master password. `migrate` re-encrypts everything stored with the old key
   * and `inTransaction` runs migrate + saving the new metadata as ONE database transaction, so a
   * crash can never leave credentials encrypted with a key the metadata doesn't match.
   */
  async changePassword(
    oldPassword: string,
    newPassword: string,
    migrate: (decryptOld: (blob: Buffer) => string, encryptNew: (text: string) => Buffer) => void,
    inTransaction: (fn: () => void) => void,
  ): Promise<void> {
    const oldKey = await this.verify(oldPassword);
    const salt = randomBytes(16);
    const newKey = await deriveKey(newPassword, salt, this.scryptParams);
    inTransaction(() => {
      migrate(
        (blob) => decryptWithKey(oldKey, blob),
        (text) => encryptWithKey(newKey, text),
      );
      this.store.save({
        salt: salt.toString('base64'),
        params: this.scryptParams,
        canary: encryptWithKey(newKey, CANARY_PLAINTEXT).toString('base64'),
      });
    });
    this.key?.fill(0);
    this.key = newKey;
    oldKey.fill(0);
  }

  lock(): void {
    this.key?.fill(0);
    this.key = null;
  }

  encrypt(plaintext: string): Buffer {
    if (!this.key) throw new VaultError('locked', 'vault is locked');
    return encryptWithKey(this.key, plaintext);
  }

  decrypt(blob: Buffer): string {
    if (!this.key) throw new VaultError('locked', 'vault is locked');
    return decryptWithKey(this.key, blob);
  }
}
