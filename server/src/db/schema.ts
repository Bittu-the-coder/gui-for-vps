import { blob, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
