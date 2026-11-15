import { z } from 'zod';

/** Hosted mode (M24): accounts, sessions, roles, audit. Request and response shapes shared by server and browser. */

export const USER_ROLES = ['admin', 'member'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Lowercase letters, digits, dot, dash or underscore');

/** At least 12 characters: length matters more than rules, and a passphrase is fine. */
export const passwordSchema = z.string().min(12, 'Use at least 12 characters').max(200);

export const LoginBodySchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(100),
  password: z.string().min(1).max(200),
  /** Six digits from the authenticator app, or a recovery code. */
  code: z.string().trim().max(32).optional(),
});

export const SetupBodySchema = z.object({
  /** Printed on the server's console at start: proves you control the machine. */
  setupToken: z.string().min(8).max(200),
  username: usernameSchema,
  password: passwordSchema,
});

export const CreateUserBodySchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(USER_ROLES).default('member'),
});

export const ChangePasswordSelfSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const AccessBodySchema = z.object({ serverIds: z.array(z.string().min(1)).max(500) });

export const SessionUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: z.enum(USER_ROLES),
  totpEnabled: z.boolean(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const AuthStatusSchema = z.object({
  /** false = local mode (token login, one person). */
  hosted: z.boolean(),
  /** Hosted, and no account exists yet: show the first-run setup. */
  setupNeeded: z.boolean(),
  user: SessionUserSchema.nullable(),
});
export type AuthStatus = z.infer<typeof AuthStatusSchema>;

export const UserRowSchema = SessionUserSchema.extend({
  disabled: z.boolean(),
  createdAt: z.number(),
  lastLoginAt: z.number().nullable(),
  serverIds: z.array(z.string()),
});
export type UserRow = z.infer<typeof UserRowSchema>;

export const AuditEntrySchema = z.object({
  id: z.number(),
  at: z.number(),
  userId: z.string().nullable(),
  username: z.string().nullable(),
  ip: z.string().nullable(),
  event: z.string(),
  serverId: z.string().nullable(),
  ok: z.boolean(),
  detail: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const SessionRowSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  lastSeen: z.number(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  current: z.boolean(),
});
export type SessionRow = z.infer<typeof SessionRowSchema>;
