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

export function runRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, vault, runner, allowedOrigins } = ctx;
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
    const r = await runner.preview(body.serverId, body.actionId, body.params);
    if (!r.ok) return reply.code(r.error === 'unknown_action' ? 404 : 400).send(r);
    return r.preview;
  });

  /**
   * Quiet read-only query for polling views (monitor, services, docker). Only `quiet` actions.
   * Always 200 with the exit code: the app decides what "docker not installed" means.
   */
  app.post('/api/runs/query', async (req, reply) => {
    const body = parseBody(PreviewBodySchema, req.body, reply);
    if (!body) return;
    if (!serverExists(body.serverId)) return reply.code(404).send({ error: 'server_not_found' });
    const r = await runner.query(body.serverId, body.actionId, body.params);
    if (r.ok) return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
    const status =
      r.error === 'unknown_action'
        ? 404
        : r.error === 'invalid_params'
          ? 400
          : r.error === 'not_quiet'
            ? 403
            : r.error === 'timeout'
              ? 504
              : 409;
    return reply.code(status).send(r);
  });

  app.post('/api/runs', async (req, reply) => {
    const body = parseBody(RunBodySchema, req.body, reply);
    if (!body) return;
    if (!serverExists(body.serverId)) return reply.code(404).send({ error: 'server_not_found' });
    const r = await runner.start(body.serverId, body.actionId, body.params, {
      confirmed: body.confirmed,
    });
    if (r.ok) {
      // Hosted mode: who ran which action, how risky, on which server. (No parameters: they may hold secrets.)
      ctx.hosted?.users.audit({
        user: req.user,
        ip: req.ip,
        event: 'run',
        serverId: body.serverId,
        detail: `${body.actionId} [${r.preview.risk}]${body.confirmed ? ' confirmed' : ''}`,
      });
      return { runId: r.run.id };
    }
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

  /** Stop a running install/command. 200 if it was running, 404 if unknown or already finished. */
  app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', async (req, reply) =>
    runner.cancel(req.params.id) ? { ok: true } : reply.code(404).send({ error: 'not_running' }),
  );

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
      // A member sees only the history of the servers they may use.
      const mine = <T extends { serverId: string }>(r: T) =>
        req.accessible === 'all' || req.accessible.includes(r.serverId);
      const rows = db
        .select()
        .from(history)
        .orderBy(desc(history.startedAt))
        .all()
        .filter(mine)
        .slice(0, limit);
      const entries: HistoryEntry[] = rows.map((r) => ({
        ...r,
        explain: actionById(r.actionId)?.explain ?? null,
      }));
      const learned = new Set<string>();
      for (const r of db
        .select({ commands: history.commands, serverId: history.serverId })
        .from(history)
        .all()
        .filter(mine)) {
        for (const c of r.commands) for (const n of commandNames(c)) learned.add(n);
      }
      return { entries, learned: [...learned].sort() };
    },
  );
}
