import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';
import {
  base32Decode,
  base32Encode,
  newTotpSecret,
  otpauthUrl,
  totpCode,
  verifyTotp,
} from './totp.js';

// RFC 6238 appendix B test vectors use the ASCII secret "12345678901234567890" (SHA-1, 8 digits there; we use 6).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors (last 6 digits of the 8-digit values)', () => {
    const vectors: [number, string][] = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ];
    for (const [t, code] of vectors) expect(totpCode(RFC_SECRET, t * 1000), String(t)).toBe(code);
  });
  it('base32 round-trips', () => {
    const b = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(b))).toEqual(b);
    expect(() => base32Decode('not*base32')).toThrow();
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
  it('accepts the current and neighbouring step, rejects others, and tells which step matched (replay defence)', () => {
    const now = 1_700_000_000_000;
    const code = totpCode(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, now)).toBe(Math.floor(now / 30_000));
    expect(verifyTotp(RFC_SECRET, code, now + 30_000)).toBe(Math.floor(now / 30_000)); // one step late
    expect(verifyTotp(RFC_SECRET, code, now + 90_000)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '000000', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
  });
  it('builds an otpauth link authenticators understand', () => {
    expect(otpauthUrl('ABC', 'ann@x')).toBe(
      'otpauth://totp/GFV:ann%40x?secret=ABC&issuer=GFV&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('password hashing', () => {
  it('verifies the right password only, with a fresh salt each time', async () => {
    const a = await hashPassword('correct horse battery', 2 ** 10);
    const b = await hashPassword('correct horse battery', 2 ** 10);
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$1024$8$1$')).toBe(true);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('correct horse batterz', a)).toBe(false);
    expect(await verifyPassword('', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
  it('treats equivalent unicode as the same password', async () => {
    const h = await hashPassword('café-passphrase', 2 ** 10);
    expect(await verifyPassword('café-passphrase', h)).toBe(true);
  });
});
