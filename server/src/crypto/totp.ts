import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** TOTP (RFC 6238, HMAC-SHA1, 30 s steps, 6 digits): what Google Authenticator, Authy, 1Password etc. implement. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = ALPHABET.indexOf(c);
    if (idx === -1) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = (): string => base32Encode(randomBytes(20));

export function totpCode(
  secretBase32: string,
  atMs: number = Date.now(),
  step = 30,
  digits = 6,
): string {
  const counter = Math.floor(atMs / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const off = h[h.length - 1]! & 15;
  const n = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(n % 10 ** digits).padStart(digits, '0');
}

/**
 * Accepts the current code and one step either side (clock drift). Returns the matching step number, so the caller can
 * refuse to accept the SAME step twice (a code that was already used is a replay).
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  atMs: number = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  for (const delta of [0, -1, 1]) {
    const t = atMs + delta * 30_000;
    const want = Buffer.from(totpCode(secretBase32, t));
    if (timingSafeEqual(want, Buffer.from(code))) return Math.floor(t / 1000 / 30);
  }
  return null;
}

export const otpauthUrl = (secret: string, account: string, issuer = 'GFV'): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
