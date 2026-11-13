import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { Health } from '@gfv/shared';
import { registerAuth } from './auth.js';
import type { AppContext } from './context.js';
import { connectionRoutes } from './routes/connections.js';
import { fileRoutes } from './routes/files.js';
import { recipeRoutes } from './routes/recipes.js';
import { runRoutes } from './routes/runs.js';
import { serverRoutes } from './routes/servers.js';
import { terminalRoutes } from './routes/terminal.js';
import { vaultRoutes } from './routes/vault.js';
import { wsRoutes } from './routes/ws.js';

export async function buildApp(token: string, ctx: AppContext) {
  const app = Fastify({
    logger: {
      level: process.env.VITEST ? 'silent' : 'info',
      redact: ['req.headers.cookie', 'req.headers["x-gfv-token"]'],
    },
  });
  // Action endpoints (connect, disconnect, lock...) take no body; clients often still send
  // `content-type: application/json`. Treat an empty body as "no body" instead of a 400.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '') return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      const err = new Error('invalid JSON') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });
  // File uploads and editor saves arrive as a raw byte stream (no body buffering, no multipart dependency).
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) =>
    done(null, payload),
  );
  await app.register(websocket);
  registerAuth(app, token);

  app.get('/api/health', async (): Promise<Health> => ({
    ok: true,
    name: 'gfv',
    version: '0.0.0',
  }));
  vaultRoutes(app, ctx);
  serverRoutes(app, ctx);
  connectionRoutes(app, ctx);
  wsRoutes(app, ctx);
  terminalRoutes(app, ctx);
  runRoutes(app, ctx);
  fileRoutes(app, ctx);
  recipeRoutes(app, ctx);

  return app;
}
