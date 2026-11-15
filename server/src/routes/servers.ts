import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { CreateServerBodySchema, UpdateServerBodySchema, type Server } from '@gfv/shared';
import type { AppContext } from '../context.js';
import { servers } from '../db/schema.js';
import { parseBody } from './util.js';

type Row = typeof servers.$inferSelect;

/** Strip the credential blob — it must never leave the server. */
function toPublic(r: Row): Server {
  const { credential: _credential, ...rest } = r;
  void _credential;
  return rest;
}

export function serverRoutes(app: FastifyInstance, { db, vault, pool }: AppContext): void {
  // Credentials need the vault key, so everything here requires an unlocked vault.
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/servers') && !vault.unlocked) {
      return reply.code(423).send({ error: 'locked' });
    }
  });

  app.get('/api/servers', async (req) =>
    db
      .select()
      .from(servers)
      .all()
      .filter((s) => req.accessible === 'all' || req.accessible.includes(s.id))
      .map(toPublic),
  );

  app.post('/api/servers', async (req, reply) => {
    const body = parseBody(CreateServerBodySchema, req.body, reply);
    if (!body) return;
    const secret =
      body.authType === 'key'
        ? { privateKey: body.privateKey, passphrase: body.passphrase }
        : { password: body.password };
    const row: Row = {
      id: randomUUID(),
      name: body.name,
      host: body.host,
      port: body.port,
      username: body.username,
      authType: body.authType,
      color: body.color,
      credential: vault.encrypt(JSON.stringify(secret)),
      createdAt: Date.now(),
    };
    db.insert(servers).values(row).run();
    return reply.code(201).send(toPublic(row));
  });

  app.put<{ Params: { id: string } }>('/api/servers/:id', async (req, reply) => {
    const body = parseBody(UpdateServerBodySchema, req.body, reply);
    if (!body) return;
    const existing = db.select().from(servers).where(eq(servers.id, req.params.id)).get();
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    const { credential, ...fields } = body;
    const patch: Partial<Row> = { ...fields };
    if (credential) {
      const { authType, ...secret } = credential;
      patch.authType = authType;
      patch.credential = vault.encrypt(JSON.stringify(secret));
    }
    if (Object.keys(patch).length > 0) {
      pool.disconnect(existing.id); // reconnect with the new settings
      db.update(servers).set(patch).where(eq(servers.id, existing.id)).run();
    }
    const updated = db.select().from(servers).where(eq(servers.id, existing.id)).get()!;
    return toPublic(updated);
  });

  app.delete<{ Params: { id: string } }>('/api/servers/:id', async (req, reply) => {
    pool.disconnect(req.params.id);
    const res = db.delete(servers).where(eq(servers.id, req.params.id)).run();
    if (res.changes === 0) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });
}
