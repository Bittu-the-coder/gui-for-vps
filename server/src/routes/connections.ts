import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { servers } from '../db/schema.js';
import { parseBody } from './util.js';

const TrustBody = z.object({ fingerprint: z.string().min(1), replace: z.boolean().optional() });

export function connectionRoutes(
  app: FastifyInstance,
  { db, vault, pool, runner }: AppContext,
): void {
  // Connecting needs decrypted credentials, so the vault must be unlocked.
  // (/api/servers/* is already guarded in serverRoutes; this covers /api/connections.)
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/connections') && !vault.unlocked) {
      return reply.code(423).send({ error: 'locked' });
    }
  });

  const exists = (id: string) => !!db.select().from(servers).where(eq(servers.id, id)).get();

  app.get('/api/connections', async () => pool.allStatuses());

  /** Always 200: the body's `status` says what happened (connected, host_key_unknown, ...). */
  app.post<{ Params: { id: string } }>('/api/servers/:id/connect', async (req, reply) => {
    if (!exists(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    return pool.connect(req.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/servers/:id/trust-host-key', async (req, reply) => {
    const body = parseBody(TrustBody, req.body, reply);
    if (!body) return;
    if (!exists(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const r = pool.trustHostKey(req.params.id, body.fingerprint, body.replace);
    if (r === 'ok') return { ok: true };
    return reply.code(r === 'no_pending' ? 404 : 409).send({ error: r });
  });

  app.post<{ Params: { id: string } }>('/api/servers/:id/disconnect', async (req, reply) => {
    if (!exists(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    pool.disconnect(req.params.id);
    return { ok: true };
  });

  /** "Test connection": connect if needed, then run a fixed `echo ok`. */
  app.post<{ Params: { id: string } }>('/api/servers/:id/test', async (req, reply) => {
    if (!exists(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    const outcome = await pool.connect(req.params.id);
    if (outcome.status !== 'connected') return outcome;
    // "Test connection" is just the connection.test action, run through the Command Runner.
    const r = runner.start(req.params.id, 'connection.test', {}, { record: false });
    if (!r.ok) return { status: 'error', message: 'connection dropped' };
    await r.run.done;
    return r.run.exitCode === 0 && r.run.outputTail.trim() === 'ok'
      ? { status: 'connected' }
      : { status: 'error', message: 'unexpected test output' };
  });
}
