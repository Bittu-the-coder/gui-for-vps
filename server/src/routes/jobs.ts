import type { FastifyInstance } from 'fastify';
import { JobCreateBodySchema, JobDecisionBodySchema, JobPlanBodySchema } from '@gfv/shared';
import type { AppContext } from '../context.js';
import type { JobError } from '../services/jobs/jobs.js';
import { originAllowed } from './origin.js';
import { parseBody } from './util.js';

/** Replays and broadcasts: the same steps on one or several servers, with pause-on-failure. */
export function jobRoutes(app: FastifyInstance, { vault, jobs, allowedOrigins }: AppContext): void {
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/jobs') && !vault.unlocked)
      return reply.code(423).send({ error: 'locked' });
  });

  const statusOf = (e: JobError) =>
    e.error === 'recipe_not_found'
      ? 404
      : e.error === 'confirmation_required'
        ? 403
        : e.error === 'not_connected'
          ? 409
          : 400;

  /** What WOULD run on each server (exact commands, risk, missing parameter values). Runs nothing. */
  app.post('/api/jobs/plan', async (req, reply) => {
    const body = parseBody(JobPlanBodySchema, req.body, reply);
    if (!body) return;
    const r = await jobs.plan(body);
    return 'error' in r ? reply.code(statusOf(r)).send(r) : r;
  });

  app.post('/api/jobs', async (req, reply) => {
    const body = parseBody(JobCreateBodySchema, req.body, reply);
    if (!body) return;
    const r = await jobs.create(body);
    if (!r.ok) return reply.code(statusOf(r.err)).send(r.err);
    return r.job.snapshot();
  });

  app.get('/api/jobs', async () => jobs.list());

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
    const live = jobs.get(req.params.id);
    if (live) return live.snapshot();
    return (
      jobs.list(200).find((j) => j.id === req.params.id) ??
      reply.code(404).send({ error: 'not_found' })
    );
  });

  app.post<{ Params: { id: string } }>('/api/jobs/:id/cancel', async (req, reply) =>
    jobs.cancel(req.params.id) ? { ok: true } : reply.code(404).send({ error: 'not_running' }),
  );

  /** A paused target waits for: retry the failed step, skip it, or abort that target. */
  app.post<{ Params: { id: string; serverId: string } }>(
    '/api/jobs/:id/targets/:serverId/decision',
    async (req, reply) => {
      const body = parseBody(JobDecisionBodySchema, req.body, reply);
      if (!body) return;
      return jobs.decide(req.params.id, req.params.serverId, body.decision)
        ? { ok: true }
        : reply.code(409).send({ error: 'not_paused' });
    },
  );

  app.delete<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) =>
    jobs.remove(req.params.id) ? { ok: true } : reply.code(404).send({ error: 'not_found' }),
  );

  /** Output so far + the current state, then live changes. The socket stays open until the client leaves. */
  app.get<{ Params: { id: string } }>(
    '/api/jobs/:id/stream',
    { websocket: true },
    (socket, req) => {
      if (!originAllowed(req.headers.origin, allowedOrigins)) {
        socket.close(1008, 'origin not allowed');
        return;
      }
      const job = jobs.get(req.params.id);
      if (!job) {
        socket.close(1000, 'unknown job');
        return;
      }
      const unsub = job.subscribe((m) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
      });
      socket.on('close', unsub);
    },
  );
}
