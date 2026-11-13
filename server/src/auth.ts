import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/** Token comes from GFV_TOKEN (set by the dev script) or is random per boot. */
export function createToken(): string {
  return process.env.GFV_TOKEN ?? randomBytes(32).toString('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(';')
    .map((p) => p.trim().split('='))
    .find(([k]) => k === name)?.[1];
}

export const COOKIE_NAME = 'gfv_token';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Is `provided` the session token? */
export const tokenMatches = (provided: string | undefined, token: string): boolean =>
  !!provided && safeEqual(provided, token);

/** The cookie that keeps the browser signed in after it opened /?token=... once. */
export const sessionCookie = (token: string): string =>
  `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict`;

/**
 * Every /api request must carry the session token, either as the `x-gfv-token` header (the dev
 * proxy and tests) or the `gfv_token` cookie (the browser, in production). This stops other
 * websites (which can reach 127.0.0.1) from talking to the API.
 *
 * A cookie is sent automatically by the browser, so cookie-authenticated requests that CHANGE
 * something must also come from our own origin: SameSite=Strict already blocks cross-site
 * requests, and this Origin check is the second lock.
 */
export function registerAuth(app: FastifyInstance, token: string, allowedOrigins: string[]): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api')) return;
    const header = req.headers['x-gfv-token'] as string | undefined;
    const cookie = cookieValue(req.headers.cookie, COOKIE_NAME);
    if (!tokenMatches(header ?? cookie, token)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!header && MUTATING.has(req.method)) {
      const origin = req.headers.origin;
      if (!origin || !allowedOrigins.includes(origin)) {
        return reply.code(403).send({ error: 'bad_origin' });
      }
    }
  });
}
