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

/**
 * Every /api request must carry the session token, either as the
 * `x-gfv-token` header or the `gfv_token` cookie. This stops other websites
 * (which can reach 127.0.0.1) from talking to the API.
 */
export function registerAuth(app: FastifyInstance, token: string): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api')) return;
    const provided =
      (req.headers['x-gfv-token'] as string | undefined) ??
      cookieValue(req.headers.cookie, 'gfv_token');
    if (!provided || !safeEqual(provided, token)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });
}
