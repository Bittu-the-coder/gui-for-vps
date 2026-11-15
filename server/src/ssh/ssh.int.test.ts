import { connect as tcp } from 'node:net';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { testCtx, testKey } from '../testUtil.js';
import { knownHosts } from '../db/schema.js';

// Integration tests against the Docker test VPS (vps-a on 127.0.0.1:2201).
// Start it with: docker compose -f e2e/docker-compose.yml up -d
const PORT = 2201;
const reachable = await new Promise<boolean>((ok) => {
  const s = tcp(PORT, '127.0.0.1');
  s.setTimeout(1500, () => (s.destroy(), ok(false)));
  s.on('connect', () => (s.end(), ok(true)));
  s.on('error', () => ok(false));
});
const privateKey = testKey();

const H = { 'x-gfv-token': 't' };

describe.skipIf(!reachable)('SSH pool against vps-a', () => {
  async function setup() {
    const ctx = testCtx();
    const app = await buildApp('t', ctx);
    const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
      app.inject({ method, url, headers: H, payload });
    await call('POST', '/api/vault/create', { password: 'master-pass' });
    const add = async (over: object = {}) =>
      (
        await call('POST', '/api/servers', {
          name: 'vps-a',
          host: '127.0.0.1',
          port: PORT,
          username: 'gfv',
          authType: 'key',
          privateKey,
          ...over,
        })
      ).json().id as string;
    return { app, ctx, call, add };
  }
  const apps: Awaited<ReturnType<typeof setup>>[] = [];
  afterAll(() => apps.forEach((a) => a.ctx.pool.disconnectAll()));
  const make = async () => (apps.push(await setup()), apps.at(-1)!);

  it('first connect stops on an unknown host key, trust it, then connects', async () => {
    const { call, add } = await make();
    const id = await add();

    const first = (await call('POST', `/api/servers/${id}/connect`)).json();
    expect(first.status).toBe('host_key_unknown');
    expect(first.fingerprint).toMatch(/^SHA256:/);
    expect(first.keyType).toMatch(/^(ssh-ed25519|ecdsa|rsa)/);

    // Trusting a fingerprint we were NOT shown is refused.
    const wrong = await call('POST', `/api/servers/${id}/trust-host-key`, {
      fingerprint: 'SHA256:bogus',
    });
    expect(wrong.statusCode).toBe(409);

    const trust = await call('POST', `/api/servers/${id}/trust-host-key`, {
      fingerprint: first.fingerprint,
    });
    expect(trust.statusCode).toBe(200);

    expect((await call('POST', `/api/servers/${id}/test`)).json().status).toBe('connected');
    expect((await call('GET', '/api/connections')).json()[id]).toBe('connected');

    await call('POST', `/api/servers/${id}/disconnect`);
    expect((await call('GET', '/api/connections')).json()[id]).toBe('disconnected');
  });

  it('refuses a CHANGED host key and requires an explicit replace', async () => {
    const { ctx, call, add } = await make();
    const id = await add();
    const first = (await call('POST', `/api/servers/${id}/connect`)).json();
    await call('POST', `/api/servers/${id}/trust-host-key`, { fingerprint: first.fingerprint });

    // Simulate the server presenting a different key by corrupting what we have stored.
    ctx.db.update(knownHosts).set({ fingerprint: 'SHA256:somethingElseEntirely' }).run();

    const changed = (await call('POST', `/api/servers/${id}/connect`)).json();
    expect(changed.status).toBe('host_key_changed');
    expect(changed.expected).toBe('SHA256:somethingElseEntirely');
    expect(changed.fingerprint).toBe(first.fingerprint);
    expect((await call('GET', '/api/connections')).json()[id]).toBe('error');

    // Plain "trust" is not enough for a changed key.
    const noReplace = await call('POST', `/api/servers/${id}/trust-host-key`, {
      fingerprint: changed.fingerprint,
    });
    expect(noReplace.json()).toEqual({ error: 'replace_required' });
    expect((await call('POST', `/api/servers/${id}/connect`)).json().status).toBe(
      'host_key_changed',
    );

    await call('POST', `/api/servers/${id}/trust-host-key`, {
      fingerprint: changed.fingerprint,
      replace: true,
    });
    expect((await call('POST', `/api/servers/${id}/connect`)).json().status).toBe('connected');
  });

  it('reports auth_failed for the wrong user, without leaking secrets', async () => {
    const { call, add } = await make();
    const id = await add({ username: 'nobody' });
    const first = (await call('POST', `/api/servers/${id}/connect`)).json();
    await call('POST', `/api/servers/${id}/trust-host-key`, { fingerprint: first.fingerprint });
    const res = await call('POST', `/api/servers/${id}/connect`);
    expect(res.json()).toEqual({ status: 'auth_failed' });
    expect(res.body).not.toContain('PRIVATE KEY');
  });

  it('reports a clear error when nothing is listening', async () => {
    const { call, add } = await make();
    const id = await add({ port: 1 });
    const res = (await call('POST', `/api/servers/${id}/connect`)).json();
    expect(res.status).toBe('error');
  });

  it('drops live connections when the vault is locked', async () => {
    const { call, add } = await make();
    const id = await add();
    const first = (await call('POST', `/api/servers/${id}/connect`)).json();
    await call('POST', `/api/servers/${id}/trust-host-key`, { fingerprint: first.fingerprint });
    await call('POST', `/api/servers/${id}/connect`);
    await call('POST', '/api/vault/lock');
    expect((await call('GET', '/api/connections')).statusCode).toBe(423);
    await call('POST', '/api/vault/unlock', { password: 'master-pass' });
    expect((await call('GET', '/api/connections')).json()[id]).toBe('disconnected');
  });

  it('WebSocket rejects a foreign Origin and accepts an allowed one', async () => {
    const { app, ctx } = await make();
    await app.ready();
    const subscribers = () => ctx.pool.listenerCount('status');

    // The server closes a bad-origin socket immediately and never subscribes to updates.
    const bad = await app.injectWS('/api/ws', { headers: { ...H, origin: 'http://evil.example' } });
    await vi.waitFor(() => expect(bad.readyState).toBe(bad.CLOSED));
    expect(subscribers()).toBe(0);

    // An allowed origin stays open, is subscribed, and receives pushed status updates.
    const good = await app.injectWS('/api/ws', {
      headers: { ...H, origin: 'http://localhost:5173' },
    });
    expect(good.readyState).toBe(good.OPEN);
    expect(subscribers()).toBe(1);
    const next = new Promise<string>((r) => good.on('message', (d: Buffer) => r(d.toString())));
    ctx.pool.emit('status', 'x', 'connected');
    expect(JSON.parse(await next).type).toBe('connections');

    good.terminate();
    await vi.waitFor(() => expect(subscribers()).toBe(0));
  });
});
