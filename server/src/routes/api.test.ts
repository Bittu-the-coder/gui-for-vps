import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { testCtx } from '../testUtil.js';

const H = { 'x-gfv-token': 't' };

async function setup(unlock = true) {
  const app = await buildApp('t', testCtx());
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: H, payload });
  if (unlock) await call('POST', '/api/vault/create', { password: 'master-pass' });
  return { app, call };
}

const keyServer = {
  name: 'vps-a',
  host: '127.0.0.1',
  port: 2201,
  username: 'gfv',
  authType: 'key',
  privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----',
};

describe('vault routes', () => {
  it('reports status, creates, locks and unlocks', async () => {
    const { call } = await setup(false);
    expect((await call('GET', '/api/vault')).json()).toEqual({
      initialized: false,
      unlocked: false,
    });
    expect((await call('POST', '/api/vault/create', { password: 'master-pass' })).json()).toEqual({
      initialized: true,
      unlocked: true,
    });
    await call('POST', '/api/vault/lock');
    expect((await call('GET', '/api/vault')).json().unlocked).toBe(false);
    expect((await call('POST', '/api/vault/unlock', { password: 'master-pass' })).statusCode).toBe(
      200,
    );
  });

  it('rejects a wrong password with 401 and a short one with 400', async () => {
    const { call } = await setup();
    await call('POST', '/api/vault/lock');
    expect((await call('POST', '/api/vault/unlock', { password: 'nope' })).statusCode).toBe(401);
    expect((await call('POST', '/api/vault/create', { password: 'short' })).statusCode).toBe(400);
  });

  it('accepts an empty body with a JSON content-type, but still rejects malformed JSON', async () => {
    const { app } = await setup();
    const h = { ...H, 'content-type': 'application/json' };
    expect(
      (await app.inject({ method: 'POST', url: '/api/vault/lock', headers: h })).statusCode,
    ).toBe(200);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/vault/unlock',
      headers: h,
      payload: '{nope',
    });
    expect(bad.statusCode).toBe(400);
  });

  it('cannot create twice', async () => {
    const { call } = await setup();
    expect((await call('POST', '/api/vault/create', { password: 'another-pass' })).statusCode).toBe(
      409,
    );
  });
});

describe('server routes', () => {
  it('returns 423 while the vault is locked', async () => {
    const { call } = await setup(false);
    expect((await call('GET', '/api/servers')).statusCode).toBe(423);
  });

  it('creates, lists, updates and deletes — and never leaks credentials', async () => {
    const { call } = await setup();
    const created = await call('POST', '/api/servers', keyServer);
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(JSON.stringify(created.json())).not.toMatch(/privateKey|credential|fake/);

    const list = await call('GET', '/api/servers');
    expect(list.json()).toHaveLength(1);
    expect(JSON.stringify(list.json())).not.toMatch(/privateKey|credential|fake/);

    const updated = await call('PUT', `/api/servers/${id}`, { name: 'renamed', color: '#ff0000' });
    expect(updated.json()).toMatchObject({ name: 'renamed', color: '#ff0000', host: '127.0.0.1' });

    expect((await call('DELETE', `/api/servers/${id}`)).statusCode).toBe(204);
    expect((await call('DELETE', `/api/servers/${id}`)).statusCode).toBe(404);
  });

  it('can swap credentials on update (key → password)', async () => {
    const { call } = await setup();
    const id = (await call('POST', '/api/servers', keyServer)).json().id;
    const res = await call('PUT', `/api/servers/${id}`, {
      credential: { authType: 'password', password: 'pw' },
    });
    expect(res.json().authType).toBe('password');
  });

  it('validates input (bad host, bad port, shell metacharacters, missing credential)', async () => {
    const { call } = await setup();
    for (const bad of [
      { ...keyServer, host: 'a b; rm -rf /' },
      { ...keyServer, port: 70000 },
      { ...keyServer, username: 'root; id' },
      { name: 'x', host: 'h', username: 'u', authType: 'password' },
    ]) {
      expect((await call('POST', '/api/servers', bad)).statusCode).toBe(400);
    }
  });

  it('requires the session token', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/servers' })).statusCode).toBe(401);
  });
});
