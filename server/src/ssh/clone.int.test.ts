import { connect as tcp } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { testCtx, testKey } from '../testUtil.js';

// "Clone this server": a recipe built from what is REALLY installed on a Docker test VPS.
const open = (port: number) =>
  new Promise<boolean>((ok) => {
    const s = tcp(port, '127.0.0.1');
    s.setTimeout(1500, () => (s.destroy(), ok(false)));
    s.on('connect', () => (s.end(), ok(true)));
    s.on('error', () => ok(false));
  });
const reachable = await open(2201);
const privateKey = testKey();
const H = { 'x-gfv-token': 't' };
vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!reachable)('clone a server into a recipe (vps-a)', () => {
  const ctx = testCtx();
  let app: FastifyInstance;
  let a: string;
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: H, payload });
  afterAll(async () => {
    ctx.pool.disconnectAll();
    await app?.close();
  });

  it('refuses while disconnected, then builds a recipe from the installed tools', async () => {
    app = await buildApp('t', ctx);
    await app.ready();
    await call('POST', '/api/vault/create', { password: 'master-pass' });
    a = (
      await call('POST', '/api/servers', {
        name: 'vps-a',
        host: '127.0.0.1',
        port: 2201,
        username: 'gfv',
        authType: 'key',
        privateKey,
      })
    ).json().id;

    const off = await call('POST', `/api/servers/${a}/clone-recipe`);
    expect(off.statusCode).toBe(409);
    expect(off.json().error).toBe('not_connected');

    const first = (await call('POST', `/api/servers/${a}/connect`)).json();
    await call('POST', `/api/servers/${a}/trust-host-key`, { fingerprint: first.fingerprint });
    expect((await call('POST', `/api/servers/${a}/connect`)).json().status).toBe('connected');

    const r = await call('POST', `/api/servers/${a}/clone-recipe`);
    // The test image has some tools (git, plus the shimmed docker): whatever is there becomes install steps.
    if (r.statusCode === 409) {
      expect(r.json().error).toBe('nothing_to_clone');
      return;
    }
    expect(r.statusCode, r.body).toBe(200);
    const { recipeId, tools } = r.json() as { recipeId: string; tools: string[] };
    expect(tools.length).toBeGreaterThan(0);
    const detail = (await call('GET', `/api/recipes/${recipeId}`)).json();
    expect(detail).toMatchObject({ name: 'Clone of vps-a', serverId: a });
    expect(detail.steps.map((s: { actionId: string }) => s.actionId)).toEqual(
      tools.map((t) => `devhub.install.${t}`),
    );
  });
});
