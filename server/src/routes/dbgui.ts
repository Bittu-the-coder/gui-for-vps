import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { classifySql, connectionSchema } from '@gfv/shared';
import type { AppContext } from '../context.js';
import { DbGuiError } from '../services/dbgui/dbgui.js';
import { parseBody } from './util.js';

const QueryBody = z.object({
  sql: z.string().min(1).max(100_000),
  /** The person chose "this may change data". Needs `confirmed` as well. */
  write: z.boolean().default(false),
  confirmed: z.boolean().optional(),
});
const TableBody = z.object({
  schema: z.string().min(1).max(200),
  table: z.string().min(1).max(200),
});

const STATUS = { not_found: 404, not_connected: 409, tunnel: 502, db_error: 400 } as const;

export function dbRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { dbs, db } = ctx;
  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof DbGuiError)
      return reply
        .code(STATUS[e.code])
        .send({ error: e.code, message: e.message, ...(e.detail ? { code: e.detail } : {}) });
    if (e instanceof Error && e.message === 'vault is locked')
      return reply.code(423).send({ error: 'locked' });
    throw e;
  };

  app.get<{ Params: { id: string } }>('/api/servers/:id/db', async (req) =>
    dbs.list(req.params.id),
  );

  app.post<{ Params: { id: string } }>('/api/servers/:id/db', async (req, reply) => {
    const body = parseBody(connectionSchema, req.body, reply);
    if (!body) return;
    try {
      return dbs.create(req.params.id, body);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete<{ Params: { connId: string } }>('/api/db/:connId', async (req, reply) =>
    dbs.remove(req.params.connId) ? { ok: true } : reply.code(404).send({ error: 'not_found' }),
  );

  app.get<{ Params: { connId: string } }>('/api/db/:connId/tables', async (req, reply) => {
    try {
      return await dbs.tables(req.params.connId);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Params: { connId: string } }>('/api/db/:connId/columns', async (req, reply) => {
    const body = parseBody(TableBody, req.body, reply);
    if (!body) return;
    try {
      return await dbs.columns(req.params.connId, body.schema, body.table);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Params: { connId: string } }>('/api/db/:connId/preview', async (req, reply) => {
    const body = parseBody(TableBody, req.body, reply);
    if (!body) return;
    try {
      return await dbs.preview(req.params.connId, body.schema, body.table);
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Params: { connId: string } }>('/api/db/:connId/query', async (req, reply) => {
    const body = parseBody(QueryBody, req.body, reply);
    if (!body) return;
    // The Safety Net is HERE: a write needs both the switch and the confirmation, whatever the client does.
    if (body.write && !body.confirmed)
      return reply.code(403).send({ error: 'confirmation_required', risk: 'danger' });
    // Hosted mode: record that a query ran, and whether it was allowed to change data. Never the SQL text.
    ctx.hosted?.users.audit({
      user: req.user,
      ip: req.ip,
      event: body.write ? 'db.write' : 'db.read',
      serverId: dbs.get(req.params.connId)?.serverId ?? null,
    });
    try {
      return await dbs.query(req.params.connId, body.sql, body.write);
    } catch (e) {
      // A read-only transaction refusing a change is the expected outcome for a write sent without the switch.
      if (
        !body.write &&
        classifySql(body.sql) === 'write' &&
        e instanceof DbGuiError &&
        e.detail === '25006'
      )
        return reply.code(400).send({
          error: 'db_error',
          code: '25006',
          message:
            'This changes data, and the query was run read-only. Turn on “allow changes” to run it.',
        });
      return fail(reply, e);
    }
  });
  void db;
}
