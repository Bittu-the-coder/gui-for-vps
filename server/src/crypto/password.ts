import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** Password hashing for hosted-mode accounts: scrypt with a random salt, stored as `scrypt$N$r$p$salt$hash` (base64). */
const KEYLEN = 32;
const DEFAULT_N = 2 ** 15;

const derive = (password: string, salt: Buffer, N: number, r: number, p: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r, p, maxmem: 256 * N * r }, (e, k) =>
      e ? reject(e) : resolve(k),
    ),
  );

export async function hashPassword(password: string, N = DEFAULT_N): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, 8, 1);
  return `scrypt$${N}$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return want.length === got.length && timingSafeEqual(want, got);
}
