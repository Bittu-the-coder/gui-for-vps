import { blob, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Single row (id = 1): salt, scrypt params and the encrypted canary. No secrets. */
export const vaultMeta = sqliteTable('vault_meta', {
  id: integer('id').primaryKey(),
  salt: text('salt').notNull(),
  params: text('params', { mode: 'json' }).$type<{ N: number; r: number; p: number }>().notNull(),
  canary: text('canary').notNull(),
});

export const servers = sqliteTable('servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull().default(22),
  username: text('username').notNull(),
  authType: text('auth_type', { enum: ['key', 'password'] }).notNull(),
  color: text('color').notNull().default('#0ea5e9'),
  /** AES-256-GCM blob (iv|tag|ciphertext) holding the key/password/passphrase JSON. */
  credential: blob('credential', { mode: 'buffer' }).notNull(),
  createdAt: integer('created_at').notNull(),
});

export const knownHosts = sqliteTable(
  'known_hosts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    keyType: text('key_type').notNull(),
    fingerprint: text('fingerprint').notNull(), // "SHA256:..." base64
    firstSeen: integer('first_seen').notNull(),
  },
  (t) => [uniqueIndex('known_hosts_server_idx').on(t.serverId)],
);

/** One row per Command Runner run. Params are already redacted; never store secrets or terminal input. */
export const history = sqliteTable('history', {
  id: text('id').primaryKey(),
  serverId: text('server_id')
    .notNull()
    .references(() => servers.id, { onDelete: 'cascade' }),
  actionId: text('action_id').notNull(),
  title: text('title').notNull(),
  params: text('params', { mode: 'json' }).$type<unknown>(),
  commands: text('commands', { mode: 'json' }).$type<string[]>().notNull(),
  risk: text('risk', { enum: ['safe', 'caution', 'danger'] }).notNull(),
  exitCode: integer('exit_code'),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  outputTail: text('output_tail').notNull().default(''),
});

/** A copy of a config file taken on the SERVER before GFV overwrote it (restore UI comes in M8). */
export const snapshots = sqliteTable('snapshots', {
  id: text('id').primaryKey(),
  serverId: text('server_id')
    .notNull()
    .references(() => servers.id, { onDelete: 'cascade' }),
  /** The file that was about to be changed. */
  path: text('path').notNull(),
  /** Where the copy lives on the server. */
  remotePath: text('remote_path').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: integer('created_at').notNull(),
  /** What made the backup: an action id, or null for the Editor's own SFTP save. */
  source: text('source'),
  runId: text('run_id'),
});

/** A recorded sequence of actions that can be exported as a bash script. */
export const recipes = sqliteTable('recipes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** The server the recording was made on. */
  serverId: text('server_id').references(() => servers.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  /** Parameters ({{name}} placeholders in steps) the recipe asks for when replayed. */
  params: text('params', { mode: 'json' }).$type<unknown[]>().notNull().default([]),
});

export const recipeSteps = sqliteTable('recipe_steps', {
  id: text('id').primaryKey(),
  recipeId: text('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  actionId: text('action_id').notNull(),
  /** Validated params (recordable actions have no secret params). The script is regenerated from these. */
  params: text('params', { mode: 'json' }).$type<unknown>(),
  createdAt: integer('created_at').notNull(),
});

/** Single row (id = 1) while a recording is in progress. */
export const recording = sqliteTable('recording', {
  id: integer('id').primaryKey(),
  recipeId: text('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  serverId: text('server_id')
    .notNull()
    .references(() => servers.id, { onDelete: 'cascade' }),
});

/**
 * Finished jobs (replays and broadcasts), for the Jobs app. Holds no parameter VALUES (they can be secrets):
 * only what ran where and how it went.
 */
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['replay', 'broadcast'] }).notNull(),
  name: text('name').notNull(),
  status: text('status', { enum: ['running', 'done', 'failed', 'cancelled'] }).notNull(),
  /** The JobSnapshot at the end (targets, step results). */
  snapshot: text('snapshot', { mode: 'json' }).$type<unknown>().notNull(),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
});

/** Saved database connections (M21). The password is encrypted with the vault key, like SSH credentials. */
export const dbConnections = sqliteTable('db_connections', {
  id: text('id').primaryKey(),
  serverId: text('server_id')
    .notNull()
    .references(() => servers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Where the database listens, as the SERVER sees it (GFV reaches it through an SSH port-forward). */
  host: text('host').notNull(),
  port: integer('port').notNull(),
  database: text('database').notNull(),
  user: text('user').notNull(),
  password: blob('password', { mode: 'buffer' }).notNull(),
  createdAt: integer('created_at').notNull(),
});

/** The AI assistant's settings (M23): a single row. The API key is encrypted with the vault key. Off by default. */
export const aiSettings = sqliteTable('ai_settings', {
  id: integer('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  provider: text('provider', { enum: ['anthropic', 'openai-compatible'] })
    .notNull()
    .default('anthropic'),
  model: text('model').notNull().default('claude-sonnet-5-5'),
  baseUrl: text('base_url').notNull().default(''),
  apiKey: blob('api_key', { mode: 'buffer' }),
});

// ---- Hosted mode (M24) ---------------------------------------------------------------------------------------------

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    /** scrypt hash (see crypto/password.ts). Never the password. */
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['admin', 'member'] })
      .notNull()
      .default('member'),
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    /** TOTP secret, encrypted with the auth key (auth.key in the data dir); null = 2FA not enabled. */
    totpSecret: blob('totp_secret', { mode: 'buffer' }),
    /** A secret being enrolled, not yet confirmed with a code. */
    totpPending: blob('totp_pending', { mode: 'buffer' }),
    totpEnabled: integer('totp_enabled', { mode: 'boolean' }).notNull().default(false),
    /** The last accepted TOTP step: the same code cannot be used twice. */
    totpLastStep: integer('totp_last_step'),
    /** sha256 of each unused recovery code (JSON array). */
    recoveryHashes: text('recovery_hashes', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: integer('created_at').notNull(),
    lastLoginAt: integer('last_login_at'),
  },
  (t) => [uniqueIndex('users_username').on(t.username)],
);

export const sessions = sqliteTable('sessions', {
  /** sha256 of the session token (the token itself is only in the browser's cookie). */
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
  lastSeen: integer('last_seen').notNull(),
  expiresAt: integer('expires_at').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
});

/** Which servers a MEMBER may use. Admins can use all of them. */
export const serverAccess = sqliteTable(
  'server_access',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.serverId] })],
);

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: integer('at').notNull(),
  userId: text('user_id'),
  username: text('username'),
  ip: text('ip'),
  event: text('event').notNull(),
  serverId: text('server_id'),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  /** Never a secret, a password, SQL text or terminal input: action ids, route names, short facts. */
  detail: text('detail'),
});
