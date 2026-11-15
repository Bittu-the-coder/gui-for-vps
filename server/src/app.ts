import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { Health } from '@gfv/shared';
import { registerAuth } from './auth.js';
import type { AppContext } from './context.js';
import { connectionRoutes } from './routes/connections.js';
import { fileRoutes } from './routes/files.js';
import { registerHosted } from './hosted.js';
import { authRoutes } from './routes/auth.js';
import { aiRoutes } from './routes/ai.js';
import { dbRoutes } from './routes/dbgui.js';
import { jobRoutes } from './routes/jobs.js';
import { recipeRoutes } from './routes/recipes.js';
import { runRoutes } from './routes/runs.js';
import { serverRoutes } from './routes/servers.js';
import { terminalRoutes } from './routes/terminal.js';
import { vaultRoutes } from './routes/vault.js';
import { wsRoutes } from './routes/ws.js';

export async function buildApp(token: string, ctx: AppContext) {
  const app = Fastify({
    // Behind the TLS proxy of a hosted install, the real client address and protocol are in X-Forwarded-*.
    trustProxy: !!ctx.hosted,
    logger: {
      level: process.env.VITEST ? 'silent' : (process.env.GFV_LOG_LEVEL ?? 'info'),
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
  // Which servers this request may touch. Local mode: all of them (hosted mode narrows it per account).
  app.decorateRequest('accessible', 'all');
  // Every route that gets registered, so tests can prove that none of them escapes the access rules.
  const routeTable: { method: string; url: string }[] = [];
  app.addHook('onRoute', (r) => {
    for (const m of [r.method].flat())
      if (m !== 'HEAD' && m !== 'OPTIONS') routeTable.push({ method: m, url: r.url });
  });
  app.decorate('routeTable', routeTable);
  await app.register(websocket);
  if (ctx.hosted) registerHosted(app, ctx, ctx.hosted);
  else registerAuth(app, token, ctx.allowedOrigins);

  app.get('/api/health', async (): Promise<Health> => ({
    ok: true,
    name: 'gfv',
    // The command line sets GFV_VERSION from package.json; from source or in tests it stays 0.0.0.
    version: process.env.GFV_VERSION ?? '0.0.0',
  }));
  vaultRoutes(app, ctx);
  serverRoutes(app, ctx);
  connectionRoutes(app, ctx);
  wsRoutes(app, ctx);
  terminalRoutes(app, ctx);
  runRoutes(app, ctx);
  fileRoutes(app, ctx);
  recipeRoutes(app, ctx);
  jobRoutes(app, ctx);
  dbRoutes(app, ctx);
  aiRoutes(app, ctx);
  authRoutes(app, ctx);

  return app;
}
