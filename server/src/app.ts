import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { Health } from '@gfv/shared';
import { registerAuth } from './auth.js';

export async function buildApp(token: string) {
  const app = Fastify({
    logger: {
      level: process.env.VITEST ? 'silent' : 'info',
      redact: ['req.headers.cookie', 'req.headers["x-gfv-token"]'],
    },
  });
  await app.register(websocket);
  registerAuth(app, token);

  app.get('/api/health', async (): Promise<Health> => ({
    ok: true,
    name: 'gfv',
    version: '0.0.0',
  }));

  return app;
}
