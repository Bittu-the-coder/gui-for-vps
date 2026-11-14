import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  BUNDLED_RECIPES,
  inspectRecipeFile,
  parseDetect,
  TOOL_IDS,
  toRecipeFile,
  exportAs,
  EXPORT_FORMATS,
  type ExportFormat,
  RenameRecipeBodySchema,
  ReorderStepsBodySchema,
  SetRecipeParamsBodySchema,
  StartRecordingBodySchema,
  UpdateStepBodySchema,
} from '@gfv/shared';
import type { AppContext } from '../context.js';
import { servers, snapshots } from '../db/schema.js';
import { parseBody } from './util.js';

/** Recipes + the recorder, and the snapshot list for the timeline. */
export function recipeRoutes(
  app: FastifyInstance,
  { db, vault, recipes, sftp, runner }: AppContext,
): void {
  app.addHook('preHandler', async (req, reply) => {
    const u = req.url;
    const mine =
      u.startsWith('/api/recipes') ||
      u.startsWith('/api/recording') ||
      u.startsWith('/api/library') ||
      /^\/api\/servers\/[^/]+\/clone-recipe/.test(u) ||
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

  /** Declare the recipe's parameters ({{name}} placeholders). */
  app.put<{ Params: { id: string } }>('/api/recipes/:id/params', async (req, reply) => {
    const body = parseBody(SetRecipeParamsBodySchema, req.body, reply);
    if (!body) return;
    const err = recipes.setParams(req.params.id, body.params);
    if (err === 'not_found') return notFound(reply);
    return err ? reply.code(400).send(err) : { ok: true };
  });

  /** Edit one step's params (validated like a real run, with placeholders filled by stand-ins). */
  app.patch<{ Params: { id: string; stepId: string } }>(
    '/api/recipes/:id/steps/:stepId',
    async (req, reply) => {
      const body = parseBody(UpdateStepBodySchema, req.body, reply);
      if (!body) return;
      const err = recipes.updateStep(req.params.id, req.params.stepId, body.params);
      if (err === 'not_found') return notFound(reply);
      return err ? reply.code(400).send(err) : { ok: true };
    },
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
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/api/recipes/:id/export',
    async (req, reply) => {
      const r = recipes.get(req.params.id);
      if (!r) return notFound(reply);
      const server = r.serverId
        ? db.select().from(servers).where(eq(servers.id, r.serverId)).get()
        : undefined;
      const format = (EXPORT_FORMATS.find((f) => f.id === req.query.format)?.id ??
        'bash') as ExportFormat;
      const result = exportAs(format, {
        name: r.name,
        steps: r.steps,
        params: r.params,
        recordedOn: server?.name,
        generatedAt: new Date(),
      });
      const slug = r.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'recipe';
      // bash keeps its old shape (`script`, `filename`); every format also returns `files` and `notes`.
      const first = result.files[0]!;
      return {
        script: first.content,
        filename: format === 'bash' ? `${slug}.sh` : first.name,
        format,
        files: result.files.map((f) => (format === 'bash' ? { ...f, name: `${slug}.sh` } : f)),
        notes: result.notes,
      };
    },
  );

  // ---- sharing, the bundled library, and cloning a server ------------------------------------
  /** The recipe as a shareable file (no secrets: secret parameters are declared, never valued). */
  app.get<{ Params: { id: string } }>('/api/recipes/:id/file', async (req, reply) => {
    const r = recipes.get(req.params.id);
    if (!r) return notFound(reply);
    return toRecipeFile(r);
  });

  /** Import a recipe file. The file is UNTRUSTED: it is validated here from scratch, whatever the browser said. */
  app.post('/api/recipes/import', async (req, reply) => {
    const file = (req.body as { file?: unknown } | undefined)?.file;
    const out = inspectRecipeFile(file);
    if (!out.ok) return reply.code(400).send({ error: 'invalid_file', problems: out.problems });
    const recipeId = recipes.create({
      name: out.file.name,
      serverId: null,
      params: out.file.params,
      steps: out.file.steps,
    });
    return { recipeId, risk: out.risk };
  });

  /** The starter recipes that ship with GFV, each described exactly as it would run. */
  app.get('/api/library', async () =>
    BUNDLED_RECIPES.map(({ id, ...file }) => {
      const out = inspectRecipeFile(file);
      return {
        id,
        name: file.name,
        description: file.description ?? '',
        tags: file.tags ?? [],
        author: file.author ?? '',
        params: file.params,
        steps: out.ok ? out.steps : [],
        risk: out.ok ? out.risk : 'danger',
      };
    }),
  );

  app.post<{ Params: { id: string } }>('/api/library/:id/import', async (req, reply) => {
    const entry = BUNDLED_RECIPES.find((r) => r.id === req.params.id);
    if (!entry) return notFound(reply);
    const { id: _id, ...file } = entry;
    void _id;
    const out = inspectRecipeFile(file);
    if (!out.ok) return reply.code(500).send({ error: 'invalid_file', problems: out.problems });
    return {
      recipeId: recipes.create({
        name: out.file.name,
        serverId: null,
        params: out.file.params,
        steps: out.file.steps,
      }),
    };
  });

  /**
   * "Clone this server": a recipe from what is installed on it NOW (the Dev Hub's detector, a quiet read-only
   * query). It reproduces the tools; it does not copy files, users or configuration.
   */
  app.post<{ Params: { id: string } }>('/api/servers/:id/clone-recipe', async (req, reply) => {
    const server = db.select().from(servers).where(eq(servers.id, req.params.id)).get();
    if (!server) return notFound(reply);
    const q = await runner.query(server.id, 'devhub.detect', {});
    if (!q.ok)
      return reply
        .code(409)
        .send({ error: q.error === 'not_connected' ? 'not_connected' : 'detect_failed' });
    const status = parseDetect(q.stdout);
    if (!status.os.supported)
      return reply.code(409).send({ error: 'unsupported_os', os: status.os.pretty });
    const installed = TOOL_IDS.filter((t) => status.tools[t]?.installed);
    if (installed.length === 0) return reply.code(409).send({ error: 'nothing_to_clone' });
    const recipeId = recipes.create({
      name: `Clone of ${server.name}`,
      serverId: server.id,
      params: [],
      steps: installed.map((t) => ({ actionId: `devhub.install.${t}`, params: {} })),
    });
    return { recipeId, tools: installed };
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

  /** Delete one backup (row + the copy on the server). */
  app.delete<{ Params: { id: string; snapshotId: string } }>(
    '/api/servers/:id/snapshots/:snapshotId',
    async (req, reply) =>
      (await sftp.deleteSnapshot(req.params.id, req.params.snapshotId).catch(() => false))
        ? { ok: true }
        : notFound(reply),
  );
}
