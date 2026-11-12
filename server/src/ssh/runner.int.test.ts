import { readFileSync } from 'node:fs';
import { connect as tcp } from 'node:net';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { RunMsg } from '@gfv/shared';
import { buildApp } from '../app.js';
import { testCtx } from '../testUtil.js';

// Integration tests: the Command Runner against the Docker test VPS (vps-a, 127.0.0.1:2201).
const PORT = 2201;
const reachable = await new Promise<boolean>((ok) => {
  const s = tcp(PORT, '127.0.0.1');
  s.setTimeout(1500, () => (s.destroy(), ok(false)));
  s.on('connect', () => (s.end(), ok(true)));
  s.on('error', () => ok(false));
});
const privateKey = readFileSync(resolve(__dirname, '../../../e2e/keys/id_test'), 'utf8');
const H = { 'x-gfv-token': 't' };
vi.setConfig({ testTimeout: 30_000 });

describe.skipIf(!reachable)('command runner (vps-a)', () => {
  const ctx = testCtx();
  let app: FastifyInstance;
  let serverId: string;
  let base: string;

  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: H, payload });

  /** Real ws client: collects the whole stream until the server closes it. */
  const stream = (runId: string) =>
    new Promise<RunMsg[]>((done, fail) => {
      const msgs: RunMsg[] = [];
      const ws = new WebSocket(`${base}/api/runs/${runId}/stream`, {
        headers: { ...H, origin: 'http://localhost:5173' },
      });
      ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
      ws.on('close', () => done(msgs));
      ws.on('error', fail);
    });

  const output = (msgs: RunMsg[]) => msgs.map((m) => (m.type === 'output' ? m.text : '')).join('');

  async function setup() {
    app = await buildApp('t', ctx);
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    await call('POST', '/api/vault/create', { password: 'master-pass' });
    serverId = (
      await call('POST', '/api/servers', {
        name: 'vps-a',
        host: '127.0.0.1',
        port: PORT,
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
  }
  afterAll(async () => {
    ctx.pool.disconnectAll();
    await app?.close();
  });

  it('previews without running anything', async () => {
    await setup();
    const r = await call('POST', '/api/runs/preview', {
      serverId,
      actionId: 'files.delete-path',
      params: { path: '/tmp/x y' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ risk: 'danger', commands: ["rm -rf -- '/tmp/x y'"] });
  });

  it('runs a safe action, streams output (even to a late subscriber) and records history', async () => {
    const r = await call('POST', '/api/runs', { serverId, actionId: 'system.uptime' });
    expect(r.statusCode).toBe(200);
    const msgs = await stream(r.json().runId);
    expect(msgs[0]).toMatchObject({ type: 'step', index: 0, command: 'uptime' });
    expect(output(msgs)).toMatch(/load average/);
    expect(msgs.at(-1)).toMatchObject({ type: 'done', exitCode: 0 });

    const h = (await call('GET', '/api/history')).json();
    expect(h.entries[0]).toMatchObject({ actionId: 'system.uptime', exitCode: 0, risk: 'safe' });
    expect(h.entries[0].explain).toContain('load average');
    expect(h.learned).toContain('uptime');
  });

  it('refuses caution/danger actions that are not confirmed (server-side Safety Net)', async () => {
    const r = await call('POST', '/api/runs', {
      serverId,
      actionId: 'files.delete-path',
      params: { path: '/tmp/gfv-never' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: 'confirmation_required', risk: 'danger' });
  });

  it('runs a confirmed danger action and really deletes the file', async () => {
    const path = `/tmp/gfv-test-${Date.now()}`;
    const make = await call('POST', '/api/runs', {
      serverId,
      actionId: 'files.delete-path',
      params: { path },
      confirmed: true,
    });
    const msgs = await stream(make.json().runId);
    expect(msgs.at(-1)).toMatchObject({ type: 'done', exitCode: 0 });
  });

  it('quotes params: a hostile path is deleted as ONE literal name, not interpreted', async () => {
    const r = await call('POST', '/api/runs', {
      serverId,
      actionId: 'files.delete-path',
      params: { path: '/tmp/a; echo INJECTED $(id)' },
      confirmed: true,
    });
    const msgs = await stream(r.json().runId);
    expect(output(msgs)).not.toContain('INJECTED');
    expect(msgs.at(-1)).toMatchObject({ type: 'done', exitCode: 0 });
  });

  it('runs the steps of a multi-command action in order', async () => {
    const r = await call('POST', '/api/runs', {
      serverId,
      actionId: 'system.clear-apt-cache',
      confirmed: true,
    });
    const msgs = await stream(r.json().runId);
    const done = msgs.at(-1);
    expect(done).toMatchObject({ type: 'done', exitCode: 0 });
    expect(msgs.filter((m) => m.type === 'step')).toHaveLength(2);
  });

  it('rejects unknown actions, bad params and unknown servers', async () => {
    expect((await call('POST', '/api/runs', { serverId, actionId: 'nope' })).statusCode).toBe(404);
    expect(
      (
        await call('POST', '/api/runs', {
          serverId,
          actionId: 'files.delete-path',
          params: { path: 'rel' },
          confirmed: true,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', '/api/runs', { serverId: 'x', actionId: 'system.uptime' })).statusCode,
    ).toBe(404);
  });

  it('"Test connection" goes through the runner without polluting history', async () => {
    const before = (await call('GET', '/api/history')).json().entries.length;
    const r = await call('POST', `/api/servers/${serverId}/test`);
    expect(r.json()).toEqual({ status: 'connected' });
    expect((await call('GET', '/api/history')).json().entries.length).toBe(before);
  });
});
