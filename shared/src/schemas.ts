import { z } from 'zod';

// ---- Vault -------------------------------------------------------------

export const VaultStatusSchema = z.object({ initialized: z.boolean(), unlocked: z.boolean() });
export type VaultStatus = z.infer<typeof VaultStatusSchema>;

export const CreateVaultBodySchema = z.object({ password: z.string().min(8).max(256) });
export const ChangePasswordBodySchema = z.object({
  oldPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256),
});

export const UnlockBodySchema = z.object({ password: z.string().min(1).max(256) });

// ---- Servers -----------------------------------------------------------

// Hostname, IPv4 or IPv6 literal. No whitespace or shell metacharacters.
const hostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.:_-]+$/, 'host may only contain letters, digits, . : _ -');

const usernameSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z_][a-z0-9_-]*\$?$/i, 'invalid unix username');

const baseServer = {
  name: z.string().trim().min(1).max(64),
  host: hostSchema,
  port: z.number().int().min(1).max(65535).default(22),
  username: usernameSchema,
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#0ea5e9'),
};

const keyAuth = z.object({
  authType: z.literal('key'),
  privateKey: z.string().min(1).max(20_000),
  passphrase: z.string().max(256).optional(),
});
const passwordAuth = z.object({
  authType: z.literal('password'),
  password: z.string().min(1).max(256),
});

/** Create: credentials are required. */
export const CreateServerBodySchema = z
  .object(baseServer)
  .and(z.discriminatedUnion('authType', [keyAuth, passwordAuth]));
export type CreateServerBody = z.infer<typeof CreateServerBodySchema>;

/** Update: credentials are optional — omit them to keep the stored ones. */
export const UpdateServerBodySchema = z.object({
  name: baseServer.name.optional(),
  host: baseServer.host.optional(),
  port: baseServer.port.removeDefault().optional(),
  username: baseServer.username.optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  credential: z.discriminatedUnion('authType', [keyAuth, passwordAuth]).optional(),
});
export type UpdateServerBody = z.infer<typeof UpdateServerBodySchema>;

/** What the API returns. Credentials are write-only and never included. */
export const ServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number(),
  username: z.string(),
  authType: z.enum(['key', 'password']),
  color: z.string(),
  createdAt: z.number(),
});
export type Server = z.infer<typeof ServerSchema>;

// ---- Connections -------------------------------------------------------

export const ConnStatusSchema = z.enum(['disconnected', 'connecting', 'connected', 'error']);
export type ConnStatus = z.infer<typeof ConnStatusSchema>;

/** Body of POST /api/servers/:id/connect and /test. Always HTTP 200; `status` says what happened. */
export const ConnectResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('connected') }),
  z.object({
    status: z.literal('host_key_unknown'),
    keyType: z.string(),
    fingerprint: z.string(),
  }),
  z.object({
    status: z.literal('host_key_changed'),
    keyType: z.string(),
    fingerprint: z.string(),
    expected: z.string(),
  }),
  z.object({ status: z.literal('auth_failed') }),
  z.object({ status: z.literal('error'), message: z.string() }),
]);
export type ConnectResult = z.infer<typeof ConnectResultSchema>;

/** Messages pushed over /api/ws. */
export const WsMessageSchema = z.object({
  type: z.literal('connections'),
  statuses: z.record(z.string(), ConnStatusSchema),
});
