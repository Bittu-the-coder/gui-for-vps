import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { VaultError } from '../crypto/vault.js';

/** Validate a request body; on failure send 400 and return undefined. */
export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
  reply: FastifyReply,
): z.infer<S> | undefined {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  void reply.code(400).send({ error: 'invalid_body', issues: r.error.issues });
  return undefined;
}

const VAULT_STATUS: Record<VaultError['code'], number> = {
  locked: 423,
  wrong_password: 401,
  already_initialized: 409,
  not_initialized: 409,
  corrupt: 500,
};

export function sendVaultError(err: unknown, reply: FastifyReply) {
  if (err instanceof VaultError) {
    return reply.code(VAULT_STATUS[err.code]).send({ error: err.code });
  }
  throw err;
}
