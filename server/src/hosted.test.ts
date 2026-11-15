import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { totpCode } from './crypto/totp.js';
import { MEMBER_RULES, ruleKey } from './hosted.js';
import { UserService } from './services/auth/users.js';
import { testCtx } from './testUtil.js';

const ORIGIN = 'https://gfv.example.com';
const SETUP = 'setup-token-for-tests';
const PW = 'a long passphrase 1';

describe('hosted mode', () => {
  let app: FastifyInstance;
  let ctx: ReturnType<typeof testCtx>;
  let users: UserService;
  let clock = 1_700_000_000_000;

  const cookieOf = (r: LightMyRequestResponse) =>
    ([r.headers['set-cookie']].flat()[0] ?? '').split(';')[0]!;
  const req = (
    method: string,
    url: string,
    o: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
  ) =>
    app.inject({
      method: method as 'GET',
      url,
      payload: o.body as object | undefined,
      headers: {
        host: 'gfv.example.com',
        'x-forwarded-proto': 'https',
        origin: ORIGIN,
        ...(o.cookie ? { cookie: o.cookie } : {}),
        ...o.headers,
      },
    });
  const login = async (username: string, password = PW, code?: string) => {
    const r = await req('POST', '/api/auth/login', {
      body: { username, password, ...(code ? { code } : {}) },
    });
    return { r, cookie: cookieOf(r) };
  };
  const setupAdmin = async () => {
    const r = await req('POST', '/api/auth/setup', {
      body: { setupToken: SETUP, username: 'admin', password: PW },
    });
    expect(r.statusCode, r.body).toBe(200);
    return cookieOf(r);
  };

  beforeEach(async () => {
    ctx = testCtx();
    users = new UserService(ctx.db, {
      scryptN: 2 ** 10,
      keyFile: join(mkdtempSync(join(tmpdir(), 'gfv-auth-')), 'auth.key'),
      now: () => clock,
    });
    ctx.hosted = { users, setupToken: SETUP };
    ctx.allowedOrigins = [ORIGIN];
    app = await buildApp('unused-local-token', ctx);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  describe('signing in', () => {
    it('shows setup first; the local token no longer opens anything; the app itself needs a session', async () => {
      expect((await req('GET', '/api/auth/status')).json()).toEqual({
        hosted: true,
        setupNeeded: true,
        user: null,
      });
      expect((await req('GET', '/api/servers')).statusCode).toBe(401);
      expect(
        (await req('GET', '/api/servers', { headers: { 'x-gfv-token': 'unused-local-token' } }))
          .statusCode,
      ).toBe(401);
      expect((await req('GET', '/api/health')).statusCode).toBe(200);
    });

    it('setup needs the token printed on the server, works once, and sets a locked-down cookie', async () => {
      const bad = await req('POST', '/api/auth/setup', {
        body: { setupToken: 'wrong-token-1234', username: 'admin', password: PW },
      });
      expect(bad.statusCode).toBe(403);
      const weak = await req('POST', '/api/auth/setup', {
        body: { setupToken: SETUP, username: 'admin', password: 'short' },
      });
      expect(weak.statusCode).toBe(400);
      const ok = await req('POST', '/api/auth/setup', {
        body: { setupToken: SETUP, username: 'Admin', password: PW },
      });
      expect(ok.statusCode).toBe(200);
      const header = String(ok.headers['set-cookie']);
      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Strict');
      expect(header).toContain('Secure'); // behind https
      expect(ok.json()).toMatchObject({ username: 'admin', role: 'admin' }); // names are lowercased
      expect(
        (
          await req('POST', '/api/auth/setup', {
            body: { setupToken: SETUP, username: 'second', password: PW },
          })
        ).statusCode,
      ).toBe(409);
      expect((await req('GET', '/api/auth/status')).json().setupNeeded).toBe(false);
    });

    it('five wrong setup tokens lock setup until the server restarts', async () => {
      for (let i = 0; i < 5; i++)
        await req('POST', '/api/auth/setup', {
          body: { setupToken: `wrong-token-${i}x`, username: 'admin', password: PW },
        });
      const r = await req('POST', '/api/auth/setup', {
        body: { setupToken: SETUP, username: 'admin', password: PW },
      });
      expect(r.statusCode).toBe(429);
    });

    it('refuses to sign in over plain http from a network address, but not from this computer', async () => {
      const plain = await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { setupToken: SETUP, username: 'admin', password: PW },
        headers: { host: 'gfv.example.com', origin: ORIGIN },
      });
      expect(plain.statusCode).toBe(400);
      expect(plain.json().error).toBe('https_required');
      const local = await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { setupToken: SETUP, username: 'admin', password: PW },
        headers: { host: '127.0.0.1:4310', origin: ORIGIN },
      });
      expect(local.statusCode).toBe(200);
      expect(String(local.headers['set-cookie'])).not.toContain('Secure'); // plain http on localhost
    });

    it('wrong password and unknown user look the same, repeated failures slow down, a good login clears it', async () => {
      await setupAdmin();
      const a = await login('admin', 'wrong password!!');
      const b = await login('nobody', 'wrong password!!');
      expect(a.r.statusCode).toBe(401);
      expect(a.r.json()).toEqual(b.r.json());
      await login('admin', 'wrong password!!');
      await login('admin', 'wrong password!!');
      const fourth = await login('admin', 'wrong password!!');
      expect(fourth.r.statusCode).toBe(401); // three free tries, then it starts to slow down...
      const slow = await login('admin', PW); // ...and now even the right password waits
      expect(slow.r.statusCode).toBe(429);
      expect(Number(slow.r.headers['retry-after'])).toBeGreaterThan(0);
      clock += 10_000;
      expect((await login('admin', PW)).r.statusCode).toBe(200);
    });

    it('logout kills the session; a disabled account loses its sessions at once', async () => {
      const adminCookie = await setupAdmin();
      await req('POST', '/api/users', {
        cookie: adminCookie,
        body: { username: 'ann', password: PW, role: 'member' },
      });
      const ann = await login('ann');
      expect(
        (await req('GET', '/api/auth/status', { cookie: ann.cookie })).json().user.username,
      ).toBe('ann');
      const annId = users.list().find((u) => u.username === 'ann')!.id;
      await req('PATCH', `/api/users/${annId}`, { cookie: adminCookie, body: { disabled: true } });
      expect((await req('GET', '/api/auth/status', { cookie: ann.cookie })).json().user).toBeNull();
      expect((await login('ann')).r.statusCode).toBe(401);
      const out = await req('POST', '/api/auth/logout', { cookie: adminCookie });
      expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
      expect((await req('GET', '/api/servers', { cookie: adminCookie })).statusCode).toBe(401);
    });

    it('sessions expire when idle for 12 hours and after 7 days', async () => {
      const c = await setupAdmin();
      clock += 11 * 3600_000;
      expect((await req('GET', '/api/auth/status', { cookie: c })).json().user).not.toBeNull(); // sliding
      clock += 11 * 3600_000 + 120_000;
      expect((await req('GET', '/api/auth/status', { cookie: c })).json().user).not.toBeNull();
      clock += 13 * 3600_000; // idle too long
      expect((await req('GET', '/api/auth/status', { cookie: c })).json().user).toBeNull();
    });

    it('changing the password signs every device out', async () => {
      const c = await setupAdmin();
      const other = (await login('admin')).cookie;
      const bad = await req('POST', '/api/auth/password', {
        cookie: c,
        body: { oldPassword: 'nope nope nope', newPassword: 'another long passphrase' },
      });
      expect(bad.statusCode).toBe(403);
      const ok = await req('POST', '/api/auth/password', {
        cookie: c,
        body: { oldPassword: PW, newPassword: 'another long passphrase' },
      });
      expect(ok.statusCode).toBe(200);
      expect((await req('GET', '/api/servers', { cookie: other })).statusCode).toBe(401);
      expect((await login('admin', 'another long passphrase')).r.statusCode).toBe(200);
    });

    it('you can list and revoke your own sessions, not other people’s', async () => {
      const c = await setupAdmin();
      const second = (await login('admin')).cookie;
      const list = (await req('GET', '/api/auth/sessions', { cookie: c })).json() as {
        id: string;
        current: boolean;
      }[];
      expect(list).toHaveLength(2);
      const other = list.find((s) => !s.current)!;
      expect(
        (await req('DELETE', `/api/auth/sessions/${other.id}`, { cookie: c })).statusCode,
      ).toBe(200);
      expect((await req('GET', '/api/servers', { cookie: second })).statusCode).toBe(401);
      expect((await req('DELETE', '/api/auth/sessions/not-mine', { cookie: c })).statusCode).toBe(
        404,
      );
    });
  });

  describe('two-factor authentication', () => {
    it('enrol, then every login needs a fresh code; a code cannot be replayed; recovery codes work once', async () => {
      const c = await setupAdmin();
      const begin = (await req('POST', '/api/auth/2fa/begin', { cookie: c })).json() as {
        secret: string;
        otpauth: string;
      };
      expect(begin.otpauth).toContain(`secret=${begin.secret}`);
      expect(
        (await req('POST', '/api/auth/2fa/confirm', { cookie: c, body: { code: '000000' } }))
          .statusCode,
      ).toBe(400);
      const conf = await req('POST', '/api/auth/2fa/confirm', {
        cookie: c,
        body: { code: totpCode(begin.secret, clock) },
      });
      expect(conf.statusCode, conf.body).toBe(200);
      const recovery = (conf.json() as { recoveryCodes: string[] }).recoveryCodes;
      expect(recovery).toHaveLength(8);
      // The secret is encrypted at rest.
      const raw = ctx.db.$client.prepare('select totp_secret from users').get() as {
        totp_secret: Buffer;
      };
      expect(raw.totp_secret.toString('latin1')).not.toContain(begin.secret);

      expect((await login('admin')).r.json().error).toBe('totp_required');
      clock += 30_000;
      expect((await login('admin', PW, '123456')).r.statusCode).toBe(401);
      const good = totpCode(begin.secret, clock);
      expect((await login('admin', PW, good)).r.statusCode).toBe(200);
      expect((await login('admin', PW, good)).r.statusCode).toBe(401); // same step again = replay
      expect((await login('admin', PW, recovery[0]!)).r.statusCode).toBe(200);
      expect((await login('admin', PW, recovery[0]!)).r.statusCode).toBe(401); // used up
    });

    it('turning it off needs the password; an administrator can reset it for someone who lost their phone', async () => {
      const adminCookie = await setupAdmin();
      await req('POST', '/api/users', {
        cookie: adminCookie,
        body: { username: 'ann', password: PW },
      });
      const ann = (await login('ann')).cookie;
      const b = (await req('POST', '/api/auth/2fa/begin', { cookie: ann })).json() as {
        secret: string;
      };
      await req('POST', '/api/auth/2fa/confirm', {
        cookie: ann,
        body: { code: totpCode(b.secret, clock) },
      });
      expect(
        (
          await req('POST', '/api/auth/2fa/disable', {
            cookie: ann,
            body: { password: 'wrong wrong wrong' },
          })
        ).statusCode,
      ).toBe(403);
      const annId = users.list().find((u) => u.username === 'ann')!.id;
      expect(
        (await req('POST', `/api/users/${annId}/reset-2fa`, { cookie: adminCookie })).statusCode,
      ).toBe(200);
      expect((await login('ann')).r.statusCode).toBe(200); // no code needed any more
    });
  });

  describe('who may call what (deny by default)', () => {
    let adminCookie = '';
    let memberCookie = '';
    let serverA = '';
    let serverB = '';
    let connA = '';
    let connB = '';

    beforeEach(async () => {
      adminCookie = await setupAdmin();
      await req('POST', '/api/vault/create', {
        cookie: adminCookie,
        body: { password: 'master-password' },
      });
      const mk = async (name: string) =>
        (
          await req('POST', '/api/servers', {
            cookie: adminCookie,
            body: {
              name,
              host: '10.0.0.1',
              port: 22,
              username: 'u',
              authType: 'password',
              password: 'x',
            },
          })
        ).json().id as string;
      serverA = await mk('A');
      serverB = await mk('B');
      connA = (
        await req('POST', `/api/servers/${serverA}/db`, {
          cookie: adminCookie,
          body: {
            name: 'a',
            host: '127.0.0.1',
            port: 5432,
            database: 'd',
            user: 'u',
            password: 'p',
          },
        })
      ).json().id;
      connB = (
        await req('POST', `/api/servers/${serverB}/db`, {
          cookie: adminCookie,
          body: {
            name: 'b',
            host: '127.0.0.1',
            port: 5432,
            database: 'd',
            user: 'u',
            password: 'p',
          },
        })
      ).json().id;
      await req('POST', '/api/users', {
        cookie: adminCookie,
        body: { username: 'ann', password: PW, role: 'member' },
      });
      const annId = users.list().find((u) => u.username === 'ann')!.id;
      expect(
        (
          await req('PUT', `/api/users/${annId}/access`, {
            cookie: adminCookie,
            body: { serverIds: [serverA] },
          })
        ).statusCode,
      ).toBe(200);
      memberCookie = (await login('ann')).cookie;
      if (!connA || !connB) throw new Error(`db connections were not created: ${connA} ${connB}`);
    });

    const fill = (url: string, server: string, conn: string) =>
      url
        .replace(':connId', conn)
        .replace(':serverId', server)
        .replace(':snapshotId', 'snap')
        .replace(':id', server);
    const bodyFor = (url: string, server: string) =>
      url === '/api/transfer'
        ? { from: { serverId: server, path: '/a' }, to: { serverId: server, path: '/b' } }
        : { serverId: server, actionId: 'system.uptime' };

    it('every route is either listed for members or closed to them: the table has no stale entries and no gaps', () => {
      const api = app.routeTable.filter((r) => r.url.startsWith('/api'));
      expect(api.length).toBeGreaterThan(50);
      const keys = new Set(api.map((r) => ruleKey(r.method, r.url)));
      const stale = Object.keys(MEMBER_RULES).filter((k) => !keys.has(k));
      expect(stale, `rules for routes that do not exist: ${stale.join(', ')}`).toEqual([]);
    });

    it('a member is refused EVERY route that is not explicitly allowed to members', async () => {
      const closed = app.routeTable.filter(
        (r) => r.url.startsWith('/api') && !MEMBER_RULES[ruleKey(r.method, r.url)],
      );
      expect(closed.length).toBeGreaterThan(30);
      const leaked: string[] = [];
      for (const r of closed) {
        const res = await req(r.method, fill(r.url, serverA, connA), {
          cookie: memberCookie,
          body: r.method === 'GET' ? undefined : {},
        });
        if (res.statusCode !== 403) leaked.push(`${r.method} ${r.url} -> ${res.statusCode}`);
      }
      expect(leaked).toEqual([]);
    });

    it(
      'server-bound routes refuse a server the member was not given, and let through the one they were',
      { timeout: 120_000 },
      async () => {
        const bound = app.routeTable
          .filter((r) => MEMBER_RULES[ruleKey(r.method, r.url)]?.server)
          .sort((a, b) => Number(a.method === 'DELETE') - Number(b.method === 'DELETE')); // deletes last: they remove what later routes need
        expect(bound.length).toBeGreaterThan(20);
        const problems: string[] = [];
        for (const r of bound) {
          if (r.url === '/api/runs/:id/cancel' || r.url === '/api/runs/:id/stream') continue; // checked through a real run below
          const send = (server: string, conn: string) =>
            req(r.method, fill(r.url, server, conn), {
              cookie: memberCookie,
              body:
                r.method === 'GET' || r.method === 'DELETE'
                  ? undefined
                  : r.url.startsWith('/api/runs') || r.url === '/api/transfer'
                    ? bodyFor(r.url, server)
                    : {},
            });
          const denied = await send(serverB, connB);
          if (denied.statusCode !== 403 || denied.json().error !== 'no_access')
            problems.push(`${r.method} ${r.url} let server B through (${denied.statusCode})`);
          const allowed = await send(serverA, connA);
          if (
            allowed.statusCode === 403 &&
            ['no_access', 'admin_only'].includes(allowed.json().error)
          )
            problems.push(`${r.method} ${r.url} refused the member's own server: ${allowed.body}`);
        }
        expect(problems).toEqual([]);
      },
    );

    it('a REAL WebSocket to a terminal is refused at the upgrade for a server the member was not given', async () => {
      await app.listen({ port: 0, host: '127.0.0.1' });
      const port = (app.server.address() as AddressInfo).port;
      const open = (server: string, cookie: string) =>
        new Promise<'open' | number>((resolve) => {
          const ws = new WebSocket(
            `ws://127.0.0.1:${port}/api/terminal/${server}?cols=80&rows=24`,
            {
              headers: { cookie, origin: ORIGIN, 'x-forwarded-proto': 'https' },
            },
          );
          ws.on('open', () => {
            ws.close();
            resolve('open');
          });
          ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
          ws.on('error', () => {});
        });
      expect(await open(serverB, memberCookie)).toBe(403);
      expect(await open(serverA, memberCookie)).toBe('open');
      expect(await open(serverA, '')).toBe(401);
    });

    it('a transfer needs access to BOTH servers, and a request with no server id is refused', async () => {
      const t = (from: string, to: string) =>
        req('POST', '/api/transfer', {
          cookie: memberCookie,
          body: { from: { serverId: from, path: '/a' }, to: { serverId: to, path: '/b' } },
        });
      expect((await t(serverA, serverB)).statusCode).toBe(403);
      expect((await t(serverB, serverA)).statusCode).toBe(403);
      expect((await t(serverA, serverA)).statusCode).not.toBe(403);
      expect(
        (
          await req('POST', '/api/runs/preview', {
            cookie: memberCookie,
            body: { actionId: 'system.uptime' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await req('POST', '/api/runs/preview', {
            cookie: memberCookie,
            body: { serverId: 'nope', actionId: 'system.uptime' },
          })
        ).statusCode,
      ).toBe(403);
    });

    it('lists, statuses and history show a member only their servers', async () => {
      const list = (await req('GET', '/api/servers', { cookie: memberCookie })).json() as {
        id: string;
      }[];
      expect(list.map((s) => s.id)).toEqual([serverA]);
      expect(
        Object.keys((await req('GET', '/api/connections', { cookie: memberCookie })).json()),
      ).not.toContain(serverB);
      ctx.db.$client
        .prepare(
          'insert into history (id, server_id, action_id, title, params, commands, risk, exit_code, started_at, finished_at, output_tail) values (?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run('h1', serverA, 'x', 'on A', '{}', '["echo a"]', 'safe', 0, 1, 2, '');
      ctx.db.$client
        .prepare(
          'insert into history (id, server_id, action_id, title, params, commands, risk, exit_code, started_at, finished_at, output_tail) values (?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run('h2', serverB, 'x', 'on B', '{}', '["secretcmd b"]', 'safe', 0, 3, 4, '');
      const h = (await req('GET', '/api/history', { cookie: memberCookie })).json() as {
        entries: { title: string }[];
        learned: string[];
      };
      expect(h.entries.map((e) => e.title)).toEqual(['on A']);
      expect(h.learned).not.toContain('secretcmd'); // not even the names of commands run elsewhere
      const adminH = (await req('GET', '/api/history', { cookie: adminCookie })).json() as {
        entries: unknown[];
      };
      expect(adminH.entries).toHaveLength(2);
    });

    it('a member cannot manage accounts, servers, the vault, recipes or the audit log; an administrator can', async () => {
      for (const [m, u] of [
        ['GET', '/api/users'],
        ['POST', '/api/users'],
        ['GET', '/api/audit'],
        ['POST', '/api/servers'],
        ['POST', '/api/vault/lock'],
        ['GET', '/api/recipes'],
        ['GET', '/api/jobs'],
        ['PUT', '/api/ai/settings'],
      ] as const) {
        const r = await req(m, u, { cookie: memberCookie, body: m === 'GET' ? undefined : {} });
        expect(r.statusCode, `${m} ${u}`).toBe(403);
      }
      expect((await req('GET', '/api/users', { cookie: adminCookie })).statusCode).toBe(200);
      expect((await req('GET', '/api/audit', { cookie: adminCookie })).statusCode).toBe(200);
    });

    it('changes from another origin are refused even with a valid cookie', async () => {
      const r = await req('POST', '/api/runs/preview', {
        cookie: memberCookie,
        body: bodyFor('', serverA),
        headers: { origin: 'https://evil.example.com' },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe('bad_origin');
    });

    it('the last administrator cannot be removed, demoted or disabled; you cannot delete yourself', async () => {
      const adminId = users.list().find((u) => u.username === 'admin')!.id;
      expect(
        (
          await req('PATCH', `/api/users/${adminId}`, {
            cookie: adminCookie,
            body: { role: 'member' },
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await req('PATCH', `/api/users/${adminId}`, {
            cookie: adminCookie,
            body: { disabled: true },
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (await req('DELETE', `/api/users/${adminId}`, { cookie: adminCookie })).statusCode,
      ).toBe(409);
    });

    it('the audit log records who did what, and never a password or a body', async () => {
      await req('POST', '/api/auth/login', {
        body: { username: 'admin', password: 'definitely wrong pw' },
      });
      await req('POST', '/api/db/' + connA + '/query', {
        cookie: memberCookie,
        body: { sql: "select 'top-secret-sql-text'" },
      });
      const log = (await req('GET', '/api/audit', { cookie: adminCookie })).json() as {
        event: string;
        username: string | null;
        ok: boolean;
        detail: string | null;
      }[];
      const events = log.map((e) => e.event);
      expect(events).toContain('auth.setup');
      expect(events).toContain('auth.login');
      expect(events).toContain('user.create');
      expect(events).toContain('user.access');
      expect(events).toContain('POST /api/servers');
      expect(
        log.some(
          (e) => e.event === 'auth.login' && !e.ok && e.detail?.includes('invalid_credentials'),
        ),
      ).toBe(true);
      expect(log.some((e) => e.event === 'db.read' && e.username === 'ann')).toBe(true);
      const all = JSON.stringify(log);
      expect(all).not.toContain('definitely wrong pw');
      expect(all).not.toContain(PW);
      expect(all).not.toContain('top-secret-sql-text');
    });
  });
});
