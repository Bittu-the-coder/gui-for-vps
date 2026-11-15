import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  ChangePasswordBodySchema,
  CreateVaultBodySchema,
  UnlockBodySchema,
  type VaultStatus,
} from '@gfv/shared';
import type { AppContext } from '../context.js';
import { aiSettings, dbConnections, servers } from '../db/schema.js';
import { AttemptThrottle } from './throttle.js';
import { parseBody, sendVaultError } from './util.js';

export function vaultRoutes(app: FastifyInstance, { vault, pool, db }: AppContext): void {
  // One counter for every route that checks the master password (unlock and change-password).
  const throttle = new AttemptThrottle();
  const tooMany = (reply: FastifyReply) => {
    const wait = throttle.retryAfterMs();
    if (wait <= 0) return false;
    const sec = Math.ceil(wait / 1000);
    void reply
      .header('retry-after', sec)
      .code(429)
      .send({ error: 'too_many_attempts', retryAfterSec: sec });
    return true;
  };
  const status = (): VaultStatus => ({ initialized: vault.initialized, unlocked: vault.unlocked });

  app.get('/api/vault', async () => status());

  app.post('/api/vault/create', async (req, reply) => {
    const body = parseBody(CreateVaultBodySchema, req.body, reply);
    if (!body) return;
    try {
      await vault.create(body.password);
      return status();
    } catch (e) {
      return sendVaultError(e, reply);
    }
  });

  app.post('/api/vault/unlock', async (req, reply) => {
    const body = parseBody(UnlockBodySchema, req.body, reply);
    if (!body) return;
    if (tooMany(reply)) return;
    try {
      await vault.unlock(body.password);
      throttle.succeed();
      return status();
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code === 'wrong_password') throttle.fail();
      return sendVaultError(e, reply);
    }
  });

  /** Re-encrypts every stored credential under a new master password. */
  app.post('/api/vault/change-password', async (req, reply) => {
    const body = parseBody(ChangePasswordBodySchema, req.body, reply);
    if (!body) return;
    if (!vault.unlocked) return reply.code(423).send({ error: 'locked' });
    if (tooMany(reply)) return;
    try {
      await vault.changePassword(
        body.oldPassword,
        body.newPassword,
        (decryptOld, encryptNew) => {
          for (const row of db.select().from(servers).all()) {
            db.update(servers)
              .set({ credential: encryptNew(decryptOld(row.credential)) })
              .where(eq(servers.id, row.id))
              .run();
          }
          // The AI key too.
          for (const row of db.select().from(aiSettings).all()) {
            if (row.apiKey)
              db.update(aiSettings)
                .set({ apiKey: encryptNew(decryptOld(row.apiKey)) })
                .where(eq(aiSettings.id, row.id))
                .run();
          }
          // Saved database passwords are encrypted with the same key: they must move with it.
          for (const row of db.select().from(dbConnections).all()) {
            db.update(dbConnections)
              .set({ password: encryptNew(decryptOld(row.password)) })
              .where(eq(dbConnections.id, row.id))
              .run();
          }
        },
        (fn) => db.transaction(fn),
      );
      throttle.succeed();
      return status();
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code === 'wrong_password') throttle.fail();
      return sendVaultError(e, reply);
    }
  });

  app.post('/api/vault/lock', async () => {
    pool.disconnectAll(); // live connections hold decrypted credentials' reach; drop them
    vault.lock();
    return status();
  });
}
