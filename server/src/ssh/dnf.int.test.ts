import { readFileSync } from 'node:fs';
import { connect as tcp } from 'node:net';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { testCtx } from '../testUtil.js';

// The dnf side of the package-manager abstraction, on a REAL Fedora container (port 2203). Start it with:
//   docker compose -f e2e/docker-compose.yml --profile fedora up -d --build vps-fedora
// Skips itself when it is not running.
const up = await new Promise<boolean>((ok) => {
  const s = tcp(2203, '127.0.0.1');
  s.setTimeout(1500, () => (s.destroy(), ok(false)));
  s.on('connect', () => (s.end(), ok(true)));
  s.on('error', () => ok(false));
});
const privateKey = readFileSync(resolve(__dirname, '../../../e2e/keys/id_test'), 'utf8');
const H = { 'x-gfv-token': 't' };
vi.setConfig({ testTimeout: 300_000 });

describe.skipIf(!up)('Dev Hub on Fedora (dnf)', () => {
  const ctx = testCtx();
  let app: FastifyInstance;
  let id: string;
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: H, payload });
  const run = async (actionId: string) => {
    const r = await call('POST', '/api/runs', {
      serverId: id,
      actionId,
      params: {},
      confirmed: true,
    });
    expect(r.statusCode, r.body).toBe(200);
    const rr = ctx.runner.get(r.json().runId)!;
    await rr.done;
    return rr;
  };
  afterAll(async () => {
    ctx.pool.disconnectAll();
    await app?.close();
  });

  it('is detected as a dnf system and the runner picks dnf', async () => {
    app = await buildApp('t', ctx);
    await app.ready();
    await call('POST', '/api/vault/create', { password: 'master-pass' });
    id = (
      await call('POST', '/api/servers', {
        name: 'fedora',
        host: '127.0.0.1',
        port: 2203,
        username: 'gfv',
        authType: 'key',
        privateKey,
      })
    ).json().id;
    const first = (await call('POST', `/api/servers/${id}/connect`)).json();
    await call('POST', `/api/servers/${id}/trust-host-key`, { fingerprint: first.fingerprint });
    expect((await call('POST', `/api/servers/${id}/connect`)).json().status).toBe('connected');
    expect((await ctx.runner.ctxFor(id)).pkg).toBe('dnf');
    const p = (
      await call('POST', '/api/runs/preview', { serverId: id, actionId: 'devhub.install.git' })
    ).json();
    expect(p.commands.join('\n')).toContain('dnf -y -q install git');
    expect(p.commands.join('\n')).not.toContain('apt-get');
  });

  it('installs and removes Git and nginx with dnf for real', async () => {
    for (const tool of ['git', 'nginx']) {
      const inst = await run(`devhub.install.${tool}`);
      expect(inst.exitCode, inst.outputTail).toBe(0);
      const un = await run(`devhub.uninstall.${tool}`);
      expect(un.exitCode, un.outputTail).toBe(0);
    }
  });

  it('refuses Docker on dnf with a clear message and installs nothing', async () => {
    const r = await run('devhub.install.docker');
    expect(r.exitCode).toBe(1);
    expect(r.outputTail).toContain('not in the standard Fedora/RHEL repositories');
  });
});
