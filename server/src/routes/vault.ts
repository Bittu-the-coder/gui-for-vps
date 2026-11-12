import type { FastifyInstance } from 'fastify';
import { CreateVaultBodySchema, UnlockBodySchema, type VaultStatus } from '@gfv/shared';
import type { AppContext } from '../context.js';
import { parseBody, sendVaultError } from './util.js';

export function vaultRoutes(app: FastifyInstance, { vault, pool }: AppContext): void {
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
    try {
      await vault.unlock(body.password);
      return status();
    } catch (e) {
      return sendVaultError(e, reply);
    }
  });

  app.post('/api/vault/lock', async () => {
    pool.disconnectAll(); // live connections hold decrypted credentials' reach; drop them
    vault.lock();
    return status();
  });
}
