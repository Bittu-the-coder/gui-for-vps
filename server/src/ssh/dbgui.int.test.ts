import { execFileSync } from 'node:child_process';
import { connect as tcp } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { APPS, parseCredentials, type QueryResult } from '@gfv/shared';
import { buildApp } from '../app.js';
import { exclusive, testCtx, testKey } from '../testUtil.js';

// The Database GUI on a REAL PostgreSQL, reached through a REAL SSH port-forward: the database runs in a Docker
// container (installed through the App Store) on the real-systemd server.
const up = await new Promise<boolean>((ok) => {
  const s = tcp(2204, '127.0.0.1');
  s.setTimeout(1500, () => (s.destroy(), ok(false)));
  s.on('connect', () => (s.end(), ok(true)));
  s.on('error', () => ok(false));
});
const privateKey = testKey();
const H = { 'x-gfv-token': 't' };
vi.setConfig({ testTimeout: 600_000, hookTimeout: 60_000 });
const box = (cmd: string) =>
  execFileSync('docker', ['exec', 'gfv-vps-systemd', 'sh', '-c', cmd], { encoding: 'utf8' }).trim();
const dockerReady = (() => {
  try {
    return up && box('docker info >/dev/null 2>&1 && echo yes') === 'yes';
  } catch {
    return false;
  }
})();

describe.skipIf(!up || !dockerReady)('Database GUI (real PostgreSQL through an SSH tunnel)', () => {
  const ctx = testCtx();
  let release: () => void = () => {};
  beforeAll(async () => {
    release = await exclusive('systemd');
  }, 1_800_000);
  let app: FastifyInstance;
  let serverId: string;
  let connId: string;
  let password = '';
  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: H, payload });
  const sql = (q: string, extra: object = {}) =>
    call('POST', `/api/db/${connId}/query`, { sql: q, ...extra });
  const wipe = () => {
    try {
      box(
        'docker rm -f gfv-postgres >/dev/null 2>&1; docker volume rm gfv-postgres-data >/dev/null 2>&1; rm -rf /home/gfv/.gfv/apps; true',
      );
    } catch {
      /* ignore */
    }
  };
  afterAll(async () => {
    wipe();
    ctx.pool.disconnectAll();
    await app?.close();
    release();
  });

  it('starts a real PostgreSQL from the App Store and saves a connection (password encrypted, never returned)', async () => {
    wipe();
    app = await buildApp('t', ctx);
    await app.ready();
    await call('POST', '/api/vault/create', { password: 'master-pass' });
    serverId = (
      await call('POST', '/api/servers', {
        name: 'systemd',
        host: '127.0.0.1',
        port: 2204,
        username: 'gfv',
        authType: 'key',
        privateKey,
      })
    ).json().id;
    const first = (await call('POST', `/api/servers/${serverId}/connect`)).json();
    await call('POST', `/api/servers/${serverId}/trust-host-key`, {
      fingerprint: first.fingerprint,
    });
    await call('POST', `/api/servers/${serverId}/connect`);
    const r = await call('POST', '/api/runs', {
      serverId,
      actionId: 'apps.install',
      params: { app: 'postgres', hostPort: 15433, expose: false },
      confirmed: true,
    });
    const run = ctx.runner.get(r.json().runId)!;
    await run.done;
    expect(run.exitCode, run.outputTail).toBe(0);
    const q = await ctx.runner.query(serverId, 'apps.credentials', { app: 'postgres' });
    if (!q.ok) throw new Error('creds');
    password = parseCredentials(
      q.stdout,
      APPS.find((a) => a.id === 'postgres')!,
    )[0]!.value;
    for (
      let i = 0;
      i < 40 &&
      !box(`docker exec gfv-postgres pg_isready -U postgres 2>&1 || true`).includes('accepting');
      i++
    )
      await new Promise((res) => setTimeout(res, 1500));

    const c = await call('POST', `/api/servers/${serverId}/db`, {
      name: 'app db',
      host: '127.0.0.1',
      port: 15433,
      database: 'postgres',
      user: 'postgres',
      password,
    });
    expect(c.statusCode, c.body).toBe(200);
    connId = c.json().id;
    expect(c.body).not.toContain(password);
    expect((await call('GET', `/api/servers/${serverId}/db`)).body).not.toContain(password);
  });

  it('reads through the tunnel: a result with columns, rows and timing', async () => {
    const r = await sql("select 6*7 as answer, 'héllo' as word, null as nothing, now() as at");
    expect(r.statusCode, r.body).toBe(200);
    const out = r.json() as QueryResult;
    expect(out.columns).toEqual(['answer', 'word', 'nothing', 'at']);
    expect(out.rows[0]!.slice(0, 3)).toEqual(['42', 'héllo', null]);
    expect(out.rows[0]![3]).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(out.truncated).toBe(false);
  });

  it('the DATABASE refuses changes unless the switch AND the confirmation are given', async () => {
    const ro = await sql('create table people (id serial primary key, name text, meta jsonb)');
    expect(ro.statusCode).toBe(400);
    expect(ro.json().code).toBe('25006'); // "read-only transaction": Postgres itself said no
    expect(ro.json().message).toContain('allow changes');
    const noConfirm = await sql('create table people (id serial primary key)', { write: true });
    expect(noConfirm.statusCode).toBe(403);
    expect(
      box(
        'docker exec gfv-postgres psql -U postgres -tAc "select count(*) from information_schema.tables where table_name=\'people\'"',
      ),
    ).toBe('0');

    const w = await sql('create table people (id serial primary key, name text, meta jsonb)', {
      write: true,
      confirmed: true,
    });
    expect(w.statusCode, w.body).toBe(200);
    expect((w.json() as QueryResult).command).toBe('CREATE');
    const ins = await sql(
      "insert into people (name, meta) values ('Ada', '{\"x\":[1,2]}'), ('Grace', null)",
      { write: true, confirmed: true },
    );
    expect((ins.json() as QueryResult).rowCount).toBe(2);
    expect(
      box('docker exec gfv-postgres psql -U postgres -tAc "select count(*) from people"'),
    ).toBe('2'); // really committed
  });

  it('browses the schema: tables, columns and a preview', async () => {
    const tables = (await call('GET', `/api/db/${connId}/tables`)).json() as {
      schema: string;
      name: string;
      kind: string;
    }[];
    expect(tables).toContainEqual({ schema: 'public', name: 'people', kind: 'table' });
    const cols = (
      await call('POST', `/api/db/${connId}/columns`, { schema: 'public', table: 'people' })
    ).json();
    expect(cols).toEqual([
      { name: 'id', type: 'integer', nullable: false },
      { name: 'name', type: 'text', nullable: true },
      { name: 'meta', type: 'jsonb', nullable: true },
    ]);
    const prev = (
      await call('POST', `/api/db/${connId}/preview`, { schema: 'public', table: 'people' })
    ).json() as QueryResult;
    expect(prev.rows).toEqual([
      ['1', 'Ada', '{"x":[1,2]}'],
      ['2', 'Grace', null],
    ]);
    // A made-up or hostile table name never reaches SQL.
    const bad = await call('POST', `/api/db/${connId}/preview`, {
      schema: 'public',
      table: 'people"; drop table people; --',
    });
    expect(bad.statusCode).toBe(400);
    expect(
      box('docker exec gfv-postgres psql -U postgres -tAc "select count(*) from people"'),
    ).toBe('2');
  });

  it('caps big results at 500 rows and says so, without loading the rest', async () => {
    const r = (await sql('select g from generate_series(1, 100000) g')).json() as QueryResult;
    expect(r.rows).toHaveLength(500);
    expect(r.truncated).toBe(true);
  });

  it('a runaway query is stopped by the statement timeout', async () => {
    const t0 = Date.now();
    const r = await sql('select pg_sleep(60)');
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('57014'); // query_canceled: statement_timeout
    expect(Date.now() - t0).toBeLessThan(30_000);
  });

  it('SQL mistakes come back as readable errors, and one statement per run', async () => {
    const r = await sql('selec 1');
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('42601');
    const two = await sql('select 1; select 2');
    expect(two.statusCode).toBe(400);
  });

  it('a wrong password and an unreachable port are explained, and the password never leaks into a message', async () => {
    const bad = (
      await call('POST', `/api/servers/${serverId}/db`, {
        name: 'bad',
        host: '127.0.0.1',
        port: 15433,
        database: 'postgres',
        user: 'postgres',
        password: 'definitely-wrong-pw',
      })
    ).json();
    const r = await call('GET', `/api/db/${bad.id}/tables`);
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('28P01');
    expect(r.body).not.toContain('definitely-wrong-pw');
    const closed = (
      await call('POST', `/api/servers/${serverId}/db`, {
        name: 'closed',
        host: '127.0.0.1',
        port: 1,
        database: 'postgres',
        user: 'postgres',
        password: 'x',
      })
    ).json();
    const t = await call('GET', `/api/db/${closed.id}/tables`);
    expect(t.statusCode).toBe(502);
    expect(t.json().error).toBe('tunnel');
  });

  it('changing the master password re-encrypts saved database passwords too', async () => {
    const ch = await call('POST', '/api/vault/change-password', {
      oldPassword: 'master-pass',
      newPassword: 'another-master-pass',
    });
    expect(ch.statusCode, ch.body).toBe(200);
    const r = await sql('select 1 as ok');
    expect(r.statusCode, r.body).toBe(200);
  });

  it('removing a connection deletes it', async () => {
    expect((await call('DELETE', `/api/db/${connId}`)).statusCode).toBe(200);
    expect((await call('GET', `/api/db/${connId}/tables`)).statusCode).toBe(404);
  });
});
