import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { aiSettingsSchema } from '@gfv/shared';
import type { AppContext } from '../context.js';
import { AiError } from '../services/ai/gateway.js';
import { parseBody } from './util.js';

const STATUS = {
  disabled: 409,
  no_key: 409,
  not_configured: 409,
  no_preview: 410,
  provider: 502,
} as const;

export function aiRoutes(app: FastifyInstance, { ai }: AppContext): void {
  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof AiError)
      return reply.code(STATUS[e.code]).send({ error: e.code, message: e.message });
    if (e instanceof z.ZodError)
      return reply.code(400).send({ error: 'invalid_body', issues: e.issues });
    if (e instanceof Error && e.message === 'vault is locked')
      return reply.code(423).send({ error: 'locked' });
    throw e;
  };

  app.get('/api/ai/settings', async () => ai.settings());

  app.put('/api/ai/settings', async (req, reply) => {
    const body = parseBody(aiSettingsSchema, req.body, reply);
    if (!body) return;
    try {
      return ai.save(body);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete('/api/ai/key', async () => {
    ai.forgetKey();
    return ai.settings();
  });

  /** Step 1: build and scrub the exact text. Nothing leaves this computer. */
  app.post('/api/ai/prepare', async (req, reply) => {
    try {
      return ai.prepare(req.body);
    } catch (e) {
      return fail(reply, e);
    }
  });

  /** Step 2: send exactly what step 1 returned, once. */
  app.post('/api/ai/send', async (req, reply) => {
    const body = parseBody(z.object({ previewId: z.string().min(8).max(64) }), req.body, reply);
    if (!body) return;
    try {
      return await ai.send(body.previewId);
    } catch (e) {
      return fail(reply, e);
    }
  });
}
