import { desc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  actionById,
  commandNames,
  listActions,
  PreviewBodySchema,
  RunBodySchema,
  type HistoryEntry,
  type HistoryResponse,
} from '@gfv/shared';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { history, servers } from '../db/schema.js';
import { originAllowed } from './origin.js';
import { parseBody } from './util.js';

export function runRoutes(
  app: FastifyInstance,
  { db, vault, runner, allowedOrigins }: AppContext,
): void {
  // Runs need credentials (the SSH pool), so the vault must be unlocked.
  app.addHook('preHandler', async (req, reply) => {
    const u = req.url;
    if (
      (u.startsWith('/api/runs') || u.startsWith('/api/history') || u.startsWith('/api/actions')) &&
      !vault.unlocked
    ) {
      return reply.code(423).send({ error: 'locked' });
    }
  });

  const serverExists = (id: string) => !!db.select().from(servers).where(eq(servers.id, id)).get();

  app.get('/api/actions', async () => listActions());

  /** Shows what WOULD run. Executes nothing. */
  app.post('/api/runs/preview', async (req, reply) => {
    const body = parseBody(PreviewBodySchema, req.body, reply);
    if (!body) return;
    const r = runner.preview(body.actionId, body.params);
    if (!r.ok) return reply.code(r.error === 'unknown_action' ? 404 : 400).send(r);
    return r.preview;
  });

  app.post('/api/runs', async (req, reply) => {
    const body = parseBody(RunBodySchema, req.body, reply);
    if (!body) return;
    if (!serverExists(body.serverId)) return reply.code(404).send({ error: 'server_not_found' });
    const r = runner.start(body.serverId, body.actionId, body.params, {
      confirmed: body.confirmed,
    });
    if (r.ok) return { runId: r.run.id };
    const status =
      r.error === 'unknown_action'
        ? 404
        : r.error === 'invalid_params'
          ? 400
          : r.error === 'confirmation_required'
            ? 403
            : 409;
    return reply.code(status).send(r);
  });

  /** Replays everything so far, then streams live, then closes. */
  app.get<{ Params: { id: string } }>(
    '/api/runs/:id/stream',
    { websocket: true },
    (socket, req) => {
      if (!originAllowed(req.headers.origin, allowedOrigins)) {
        socket.close(1008, 'origin not allowed');
        return;
      }
      const run = runner.get(req.params.id);
      if (!run) {
        socket.send(JSON.stringify({ type: 'error', message: 'This run no longer exists.' }));
        socket.close(1000, 'unknown run');
        return;
      }
      const unsub = run.subscribe((m) => {
        if (socket.readyState !== socket.OPEN) return;
        socket.send(JSON.stringify(m));
        if (m.type === 'done' || m.type === 'error') socket.close(1000, 'finished');
      });
      socket.on('close', unsub);
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/api/history',
    async (req): Promise<HistoryResponse> => {
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
      const rows = db.select().from(history).orderBy(desc(history.startedAt)).limit(limit).all();
      const entries: HistoryEntry[] = rows.map((r) => ({
        ...r,
        explain: actionById(r.actionId)?.explain ?? null,
      }));
      const learned = new Set<string>();
      for (const r of db.select({ commands: history.commands }).from(history).all()) {
        for (const c of r.commands) for (const n of commandNames(c)) learned.add(n);
      }
      return { entries, learned: [...learned].sort() };
    },
  );
}
