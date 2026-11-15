import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import Cursor from 'pg-cursor';
import {
  formatCell,
  QUERY_MAX_ROWS,
  quoteIdent,
  type ConnectionInput,
  type DbColumn,
  type DbTable,
  type PublicConnection,
  type QueryResult,
} from '@gfv/shared';
import type { Vault } from '../../crypto/vault.js';
import type { Db } from '../../db/index.js';
import { dbConnections } from '../../db/schema.js';
import type { SshPool } from '../../ssh/pool.js';

export class DbGuiError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_connected' | 'tunnel' | 'db_error',
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

const STATEMENT_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Database GUI (M21). The database is reached THROUGH the SSH connection to its server (a direct-tcpip port-forward):
 * no port is opened on this computer or on the server, and the password never leaves GFV's process except inside the
 * encrypted tunnel. This is the third sanctioned path next to the PTY and SFTP that does not go through the Command
 * Runner: a SQL session has no shell command to show, and the database itself enforces read-only (`BEGIN READ ONLY`).
 */
export class DbService {
  constructor(
    private db: Db,
    private vault: Vault,
    private pool: SshPool,
  ) {}

  private pub(r: typeof dbConnections.$inferSelect): PublicConnection {
    return {
      id: r.id,
      serverId: r.serverId,
      name: r.name,
      host: r.host,
      port: r.port,
      database: r.database,
      user: r.user,
    };
  }

  list(serverId: string): PublicConnection[] {
    return this.db
      .select()
      .from(dbConnections)
      .where(eq(dbConnections.serverId, serverId))
      .all()
      .map((r) => this.pub(r));
  }

  create(serverId: string, input: ConnectionInput): PublicConnection {
    const row = {
      id: randomUUID(),
      serverId,
      name: input.name,
      host: input.host,
      port: input.port,
      database: input.database,
      user: input.user,
      password: this.vault.encrypt(input.password),
      createdAt: Date.now(),
    };
    this.db.insert(dbConnections).values(row).run();
    return this.pub(row);
  }

  remove(id: string): boolean {
    return this.db.delete(dbConnections).where(eq(dbConnections.id, id)).run().changes > 0;
  }

  get(id: string) {
    return this.db.select().from(dbConnections).where(eq(dbConnections.id, id)).get();
  }

  /** Opens the tunnel and a PostgreSQL client over it, runs `fn`, and always closes both. */
  private async withClient<T>(id: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
    const row = this.get(id);
    if (!row) throw new DbGuiError('not_found', 'That connection does not exist.');
    const ssh = this.pool.getClient(row.serverId);
    if (!ssh) throw new DbGuiError('not_connected', 'The server is not connected.');
    const channel = await new Promise<import('ssh2').ClientChannel>((resolve, reject) =>
      ssh.forwardOut('127.0.0.1', 0, row.host, row.port, (err, ch) =>
        err
          ? reject(
              new DbGuiError(
                'tunnel',
                `The server could not reach ${row.host}:${row.port} (${err.message}).`,
              ),
            )
          : resolve(ch),
      ),
    );
    // pg expects a net.Socket: give the SSH channel the two methods it calls, and announce it as connected.
    const stream = channel as unknown as import('node:stream').Duplex & {
      setNoDelay: () => unknown;
      setKeepAlive: () => unknown;
      connect: () => unknown;
    };
    stream.setNoDelay = () => stream;
    stream.setKeepAlive = () => stream;
    stream.connect = () => {
      process.nextTick(() => stream.emit('connect'));
      return stream;
    };
    const client = new pg.Client({
      user: row.user,
      password: this.vault.decrypt(row.password),
      database: row.database,
      stream: () => stream,
      ssl: false,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      statement_timeout: STATEMENT_TIMEOUT_MS,
    });
    client.on('error', () => {}); // surfaced through the failing call
    try {
      await client.connect();
      return await fn(client);
    } catch (e) {
      throw this.wrap(e);
    } finally {
      await client.end().catch(() => {});
      channel.destroy();
    }
  }

  private wrap(e: unknown): Error {
    if (e instanceof DbGuiError) return e;
    const err = e as { message?: string; code?: string; position?: string };
    // pg messages never contain the password; the code ("28P01" bad password, "42P01" no table...) helps the UI.
    return new DbGuiError('db_error', err.message ?? 'The database refused the request.', err.code);
  }

  async tables(id: string): Promise<DbTable[]> {
    return this.withClient(id, async (c) => {
      const r = await c.query(
        `select table_schema, table_name, table_type from information_schema.tables
         where table_schema not in ('pg_catalog','information_schema') and table_schema not like 'pg_toast%'
         order by table_schema, table_name`,
      );
      return r.rows.map((x) => ({
        schema: x.table_schema as string,
        name: x.table_name as string,
        kind: x.table_type === 'VIEW' ? ('view' as const) : ('table' as const),
      }));
    });
  }

  async columns(id: string, schema: string, table: string): Promise<DbColumn[]> {
    return this.withClient(id, async (c) => {
      const r = await c.query(
        `select column_name, data_type, is_nullable from information_schema.columns
         where table_schema = $1 and table_name = $2 order by ordinal_position`,
        [schema, table],
      );
      return r.rows.map((x) => ({
        name: x.column_name as string,
        type: x.data_type as string,
        nullable: x.is_nullable === 'YES',
      }));
    });
  }

  /** First rows of a table. The name is checked against the catalog (parameterised) before it is quoted into SQL. */
  async preview(id: string, schema: string, table: string): Promise<QueryResult> {
    const exists = (await this.tables(id)).some((t) => t.schema === schema && t.name === table);
    if (!exists) throw new DbGuiError('db_error', `There is no table ${schema}.${table}.`, '42P01');
    return this.query(id, `select * from ${quoteIdent(schema)}.${quoteIdent(table)}`, false);
  }

  /**
   * One statement. Reads run in a READ ONLY transaction that is always rolled back: the database itself refuses
   * to change anything. A write needs `write: true` (the route requires confirmation) and is committed.
   * At most QUERY_MAX_ROWS rows are fetched, through a cursor, so a huge table cannot fill memory.
   */
  async query(id: string, sql: string, write: boolean): Promise<QueryResult> {
    return this.withClient(id, async (c) => {
      const started = Date.now();
      await c.query(write ? 'BEGIN' : 'BEGIN READ ONLY');
      try {
        await c.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
        const cursor = c.query(new Cursor(sql, [], { rowMode: 'array' }));
        const { rows, result } = await new Promise<{ rows: unknown[][]; result: pg.QueryResult }>(
          (resolve, reject) =>
            cursor.read(QUERY_MAX_ROWS + 1, (err, rs, res) =>
              err ? reject(err) : resolve({ rows: rs as unknown[][], result: res }),
            ),
        );
        const truncated = rows.length > QUERY_MAX_ROWS;
        await new Promise<void>((resolve) => cursor.close(() => resolve()));
        await c.query(write ? 'COMMIT' : 'ROLLBACK');
        return {
          columns: (result.fields ?? []).map((f) => f.name),
          rows: rows.slice(0, QUERY_MAX_ROWS).map((r) => r.map(formatCell)),
          truncated,
          command: result.command ?? '',
          rowCount: result.rowCount,
          ms: Date.now() - started,
        };
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      }
    });
  }
}
