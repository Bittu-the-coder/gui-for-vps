import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  exportRecipe,
  RenameRecipeBodySchema,
  ReorderStepsBodySchema,
  StartRecordingBodySchema,
} from '@gfv/shared';
import type { AppContext } from '../context.js';
import { servers, snapshots } from '../db/schema.js';
import { parseBody } from './util.js';

/** Recipes + the recorder, and the snapshot list for the timeline. */
export function recipeRoutes(app: FastifyInstance, { db, vault, recipes }: AppContext): void {
  app.addHook('preHandler', async (req, reply) => {
    const u = req.url;
    const mine =
      u.startsWith('/api/recipes') ||
      u.startsWith('/api/recording') ||
      /^\/api\/servers\/[^/]+\/snapshots/.test(u);
    if (mine && !vault.unlocked) return reply.code(423).send({ error: 'locked' });
  });

  const notFound = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
    reply.code(404).send({ error: 'not_found' });

  app.get('/api/recipes', async () => recipes.list());

  app.get<{ Params: { id: string } }>(
    '/api/recipes/:id',
    async (req, reply) => recipes.get(req.params.id) ?? notFound(reply),
  );

  app.patch<{ Params: { id: string } }>('/api/recipes/:id', async (req, reply) => {
    const body = parseBody(RenameRecipeBodySchema, req.body, reply);
    if (!body) return;
    return recipes.rename(req.params.id, body.name) ? { ok: true } : notFound(reply);
  });

  app.delete<{ Params: { id: string } }>('/api/recipes/:id', async (req, reply) =>
    recipes.remove(req.params.id) ? { ok: true } : notFound(reply),
  );

  app.post<{ Params: { id: string } }>('/api/recipes/:id/steps/reorder', async (req, reply) => {
    const body = parseBody(ReorderStepsBodySchema, req.body, reply);
    if (!body) return;
    const err = recipes.reorder(req.params.id, body.order);
    if (err === 'not_found') return notFound(reply);
    return err ? reply.code(400).send({ error: err }) : { ok: true };
  });

  app.delete<{ Params: { id: string; stepId: string } }>(
    '/api/recipes/:id/steps/:stepId',
    async (req, reply) =>
      recipes.deleteStep(req.params.id, req.params.stepId) ? { ok: true } : notFound(reply),
  );

  /** The bash script for a recipe (generated fresh from its steps). */
  app.get<{ Params: { id: string } }>('/api/recipes/:id/export', async (req, reply) => {
    const r = recipes.get(req.params.id);
    if (!r) return notFound(reply);
    const server = r.serverId
      ? db.select().from(servers).where(eq(servers.id, r.serverId)).get()
      : undefined;
    const script = exportRecipe({
      name: r.name,
      steps: r.steps,
      recordedOn: server?.name,
      generatedAt: new Date(),
    });
    const filename = `${r.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'recipe'}.sh`;
    return { script, filename };
  });

  // ---- recording ----------------------------------------------------------------------
  app.get('/api/recording', async () => recipes.state());

  app.post('/api/recording/start', async (req, reply) => {
    const body = parseBody(StartRecordingBodySchema, req.body, reply);
    if (!body) return;
    if (!db.select().from(servers).where(eq(servers.id, body.serverId)).get())
      return notFound(reply);
    const r = recipes.start(body.serverId, body.name);
    return typeof r === 'string' ? reply.code(409).send({ error: r }) : r;
  });

  app.post('/api/recording/stop', async (_req, reply) => {
    const r = recipes.stop();
    return typeof r === 'string' ? reply.code(409).send({ error: r }) : r;
  });

  // ---- snapshots -------------------------------------------------------------------------
  /** Every backup GFV made on this server, newest first (the timeline groups them by file). */
  app.get<{ Params: { id: string } }>('/api/servers/:id/snapshots', async (req) =>
    db
      .select()
      .from(snapshots)
      .where(eq(snapshots.serverId, req.params.id))
      .orderBy(desc(snapshots.createdAt))
      .all(),
  );
}
