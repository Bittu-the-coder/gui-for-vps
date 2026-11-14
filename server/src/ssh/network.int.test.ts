import { readFileSync } from 'node:fs';
import { connect as tcp } from 'node:net';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { parsePorts, parseSites } from '@gfv/shared';
import { buildApp } from '../app.js';
import { testCtx } from '../testUtil.js';

// Ports and nginx sites on a REAL Ubuntu container (vps-b): real nginx, real `nginx -t`, real `ss`.
// (There is no systemd: the shim answers `systemctl reload`, so the reload step itself is canned.)
const reachable = await new Promise<boolean>((ok) => {
  const s = tcp(2202, '127.0.0.1');
  s.setTimeout(1500, () => (s.destroy(), ok(false)));
  s.on('connect', () => (s.end(), ok(true)));
  s.on('error', () => ok(false));
});
const privateKey = readFileSync(resolve(__dirname, '../../../e2e/keys/id_test'), 'utf8');
const H = { 'x-gfv-token': 't' };
vi.setConfig({ testTimeout: 400_000, hookTimeout: 120_000 });

describe.skipIf(!reachable)('ports and nginx sites (vps-b)', () => {
  const ctx = testCtx();
  let app: FastifyInstance;
  let id: string;
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: H, payload });
  const remote = (cmd: string) =>
    new Promise<{ code: number; out: string }>((res, rej) =>
      ctx.pool.getClient(id)!.exec(cmd, (e, st) => {
        if (e) return rej(e);
        let out = '';
        st.on('data', (d: Buffer) => (out += d));
        st.stderr.on('data', (d: Buffer) => (out += d));
        st.on('close', (code: number) => res({ code, out: out.trim() }));
      }),
    );
  const run = async (actionId: string, params: object = {}) => {
    const r = await call('POST', '/api/runs', { serverId: id, actionId, params, confirmed: true });
    expect(r.statusCode, r.body).toBe(200);
    const rr = ctx.runner.get(r.json().runId)!;
    await rr.done;
    return rr;
  };
  const query = async (actionId: string) => {
    const r = await call('POST', '/api/runs/query', { serverId: id, actionId, params: {} });
    expect(r.statusCode, r.body).toBe(200);
    return r.json().stdout as string;
  };

  afterAll(async () => {
    if (id) {
      await remote(
        'sudo rm -f /etc/nginx/conf.d/zz-gfv-broken.conf /etc/nginx/sites-enabled/gfv-int.test /etc/nginx/sites-available/gfv-int.test',
      ).catch(() => {});
    }
    ctx.pool.disconnectAll();
    await app?.close();
  });

  it('sets up: connect, install iproute2 (for ss) and nginx for real', async () => {
    app = await buildApp('t', ctx);
    await app.ready();
    await call('POST', '/api/vault/create', { password: 'master-pass' });
    id = (
      await call('POST', '/api/servers', {
        name: 'vps-b',
        host: '127.0.0.1',
        port: 2202,
        username: 'gfv',
        authType: 'key',
        privateKey,
      })
    ).json().id;
    const first = (await call('POST', `/api/servers/${id}/connect`)).json();
    await call('POST', `/api/servers/${id}/trust-host-key`, { fingerprint: first.fingerprint });
    expect((await call('POST', `/api/servers/${id}/connect`)).json().status).toBe('connected');
    // Other integration tests install packages on this container too: retry while apt is busy.
    let ss = { out: '' };
    for (let i = 0; i < 12 && !ss.out.includes('/ss'); i++) {
      ss = await remote(
        'command -v ss || (sudo apt-get update -q && sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -q -o DPkg::Lock::Timeout=120 iproute2) >/dev/null 2>&1; command -v ss',
      );
      if (!ss.out.includes('/ss')) await new Promise((r) => setTimeout(r, 10_000));
    }
    expect(ss.out).toContain('/ss');
    const nginx = await run('devhub.install.nginx');
    expect(nginx.exitCode, nginx.outputTail).toBe(0);
  });

  it('lists the listening ports with the program that owns them', async () => {
    const ports = parsePorts(await query('ports.list'));
    const ssh = ports.find((p) => p.port === 22);
    expect(ssh, JSON.stringify(ports)).toMatchObject({ proto: 'tcp', process: 'sshd' });
  });

  it('lists the stock nginx site, then adds a proxy site that REALLY passes nginx -t', async () => {
    expect(parseSites(await query('nginx.sites.list')).map((s) => s.name)).toContain('default');

    const r = await run('nginx.site.create', { kind: 'proxy', domain: 'gfv-int.test', port: 3000 });
    expect(r.exitCode, r.outputTail).toBe(0);
    expect((await remote('sudo nginx -t')).code).toBe(0);
    expect((await remote('test -L /etc/nginx/sites-enabled/gfv-int.test && echo linked')).out).toBe(
      'linked',
    );
    expect((await remote('cat /etc/nginx/sites-available/gfv-int.test')).out).toContain(
      'proxy_pass http://127.0.0.1:3000;',
    );

    const site = parseSites(await query('nginx.sites.list')).find((s) => s.name === 'gfv-int.test');
    expect(site).toMatchObject({
      enabled: true,
      serverNames: ['gfv-int.test'],
      target: 'http://127.0.0.1:3000',
      managedByGfv: true,
      https: false,
    });
  });

  it('re-saving a site backs the old version up first (visible in the timeline)', async () => {
    const r = await run('nginx.site.create', {
      kind: 'static',
      domain: 'gfv-int.test',
      root: '/var/www/html',
    });
    expect(r.exitCode, r.outputTail).toBe(0);
    expect(r.outputTail).toContain('Snapshot saved');
    const snaps = (await call('GET', `/api/servers/${id}/snapshots`)).json() as {
      path: string;
      source: string;
    }[];
    expect(
      snaps.some(
        (s) =>
          s.path === '/etc/nginx/sites-available/gfv-int.test' && s.source === 'nginx.site.create',
      ),
    ).toBe(true);
  });

  it('ROLLS BACK when nginx rejects the configuration: the new site is not left enabled', async () => {
    // Break the whole nginx config, as a bad hand-edit would.
    await remote(
      "printf 'this is not valid nginx;' | sudo tee /etc/nginx/conf.d/zz-gfv-broken.conf >/dev/null",
    );
    await remote('sudo rm -f /etc/nginx/sites-enabled/gfv-int.test');
    const r = await run('nginx.site.create', { kind: 'proxy', domain: 'gfv-int.test', port: 4000 });
    expect(r.exitCode).toBe(1);
    expect(r.outputTail).toContain('nginx rejected this configuration');
    expect(
      (
        await remote(
          'test -e /etc/nginx/sites-enabled/gfv-int.test && echo still-enabled || echo removed',
        )
      ).out,
    ).toBe('removed');
    await remote('sudo rm -f /etc/nginx/conf.d/zz-gfv-broken.conf');
    expect((await remote('sudo nginx -t')).code).toBe(0); // and nginx is healthy again
  });

  it('removes a site (link and file), with a backup', async () => {
    await run('nginx.site.create', { kind: 'proxy', domain: 'gfv-int.test', port: 3000 });
    const r = await run('nginx.site.remove', { domain: 'gfv-int.test' });
    expect(r.exitCode, r.outputTail).toBe(0);
    expect(
      (
        await remote(
          'ls /etc/nginx/sites-available /etc/nginx/sites-enabled | grep -c gfv-int.test || true',
        )
      ).out,
    ).toBe('0');
    expect(parseSites(await query('nginx.sites.list')).map((s) => s.name)).not.toContain(
      'gfv-int.test',
    );
  });

  it('HTTPS fails cleanly without certbot instead of doing something half-way', async () => {
    const r = await run('domains.https', { domain: 'gfv-int.test', email: 'me@example.com' });
    expect(r.exitCode).toBe(1);
    expect(r.outputTail).toContain('certbot is not installed');
  });
});
