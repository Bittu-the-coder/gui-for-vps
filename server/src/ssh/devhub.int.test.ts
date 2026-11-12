import { readFileSync } from 'node:fs';
import { connect as tcp } from 'node:net';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { parseDetect, type RunMsg } from '@gfv/shared';
import { buildApp } from '../app.js';
import { testCtx } from '../testUtil.js';

// Integration: Dev Hub detection, cancellation and (opt-in) a real install on the Docker test VPS (vps-b).
// vps-b, not vps-a: installs hold the apt lock, which would break the apt test in runner.int.test.ts
// when vitest runs the two files in parallel.
const PORT = 2202;
const reachable = await new Promise<boolean>((ok) => {
  const s = tcp(PORT, '127.0.0.1');
  s.setTimeout(1500, () => (s.destroy(), ok(false)));
  s.on('connect', () => (s.end(), ok(true)));
  s.on('error', () => ok(false));
});
const privateKey = readFileSync(resolve(__dirname, '../../../e2e/keys/id_test'), 'utf8');
const H = { 'x-gfv-token': 't' };
vi.setConfig({ testTimeout: 60_000 });
// Real installs download packages: slow on bad networks, so only with GFV_SLOW_TESTS=1.
const slow = process.env.GFV_SLOW_TESTS === '1';

describe.skipIf(!reachable)('dev hub (vps-b)', () => {
  const ctx = testCtx();
  let app: FastifyInstance;
  let id: string;
  let base: string;

  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: H, payload });
  const detect = async () =>
    parseDetect(
      (await call('POST', '/api/runs/query', { serverId: id, actionId: 'devhub.detect' })).json()
        .stdout,
    );
  /** Run a command on the server directly (test-only), to look at what is really running there. */
  const remote = (cmd: string) =>
    new Promise<string>((res, rej) =>
      ctx.pool.getClient(id)!.exec(cmd, (e, st) => {
        if (e) return rej(e);
        let o = '';
        st.on('data', (d: Buffer) => (o += d));
        st.on('close', () => res(o.trim()));
      }),
    );
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

  afterAll(async () => {
    ctx.pool.disconnectAll();
    await app?.close();
  });

  it('sets up', async () => {
    app = await buildApp('t', ctx);
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    await call('POST', '/api/vault/create', { password: 'master-pass' });
    id = (
      await call('POST', '/api/servers', {
        name: 'vps-b',
        host: '127.0.0.1',
        port: PORT,
        username: 'gfv',
        authType: 'key',
        privateKey,
      })
    ).json().id;
    const first = (await call('POST', `/api/servers/${id}/connect`)).json();
    await call('POST', `/api/servers/${id}/trust-host-key`, { fingerprint: first.fingerprint });
    expect((await call('POST', `/api/servers/${id}/connect`)).json().status).toBe('connected');
  });

  it('detects the distro and which tools are installed (docker is a shim here)', async () => {
    const s = await detect();
    expect(s.os.supported).toBe(true);
    expect(s.os.pretty).toMatch(/Ubuntu/);
    expect(s.tools.docker).toMatchObject({ installed: true, version: '27.1.1', running: true });
    // vps-b may have had Node/PostgreSQL installed by an earlier GFV_SLOW_TESTS run: only check shape
    expect(typeof s.tools.node.installed).toBe('boolean');
    expect(typeof s.tools.postgresql.installed).toBe('boolean');
  });

  it('the preview marks installs as long-running (Hide/Cancel in the UI)', async () => {
    const p = (
      await call('POST', '/api/runs/preview', { serverId: id, actionId: 'devhub.install.git' })
    ).json();
    expect(p).toMatchObject({ longRunning: true, risk: 'caution' });
    expect(p.commands[0]).toContain('/etc/os-release');
    expect(
      (await call('POST', '/api/runs', { serverId: id, actionId: 'devhub.install.git' }))
        .statusCode,
    ).toBe(403);
  });

  it('cancel stops a running install: the stream says cancelled and nothing is left running', async () => {
    // The guard passes, then `apt-get update` runs (or waits on the network): cancel it mid-way.
    const r = await call('POST', '/api/runs', {
      serverId: id,
      actionId: 'devhub.install.git',
      confirmed: true,
    });
    const runId = r.json().runId;
    const done = stream(runId);
    const run = ctx.runner.get(runId)!;
    await vi.waitFor(
      () => expect(run.messages.some((m) => m.type === 'step' && m.index === 1)).toBe(true),
      { timeout: 15_000 },
    );
    await new Promise((r2) => setTimeout(r2, 800));
    expect((await call('POST', `/api/runs/${runId}/cancel`)).statusCode).toBe(200);
    const msgs = await done;
    const last = msgs.at(-1);
    expect(last).toMatchObject({ type: 'done', cancelled: 'user' });
    expect((last as { exitCode: number }).exitCode).not.toBe(0);
    // No apt left behind (the Ctrl-C reached the whole process group).
    await vi.waitFor(async () => expect(await remote('pgrep -c apt-get || true')).toBe('0'), {
      timeout: 10_000,
    });
    // Cancelling again, or an unknown run: 404
    expect((await call('POST', `/api/runs/${runId}/cancel`)).statusCode).toBe(404);
    expect((await call('POST', '/api/runs/nope/cancel')).statusCode).toBe(404);
  });

  // The M7 milestone check: Node and PostgreSQL on a clean Ubuntu container.
  describe.skipIf(!slow)('real installs (download packages, slow)', () => {
    const runAction = async (actionId: string) => {
      const r = await call('POST', '/api/runs', { serverId: id, actionId, confirmed: true });
      const run = ctx.runner.get(r.json().runId)!;
      await run.done;
      return run;
    };

    it('installs Node.js 22 through nvm and detects it', { timeout: 1_800_000 }, async () => {
      const run = await runAction('devhub.install.node');
      expect(run.exitCode, run.outputTail).toBe(0);
      expect((await detect()).tools.node).toMatchObject({ installed: true });
      expect((await detect()).tools.node.version).toMatch(/^22\./);
    });

    it('installs PostgreSQL and detects it', { timeout: 1_800_000 }, async () => {
      const run = await runAction('devhub.install.postgresql');
      expect(run.exitCode, run.outputTail).toBe(0);
      const st = (await detect()).tools.postgresql;
      expect(st.installed).toBe(true);
      expect(st.version).toMatch(/^\d+/);
    });

    it('uninstalls Node (removes ~/.nvm) and keeps the rest', { timeout: 300_000 }, async () => {
      const run = await runAction('devhub.uninstall.node');
      expect(run.exitCode, run.outputTail).toBe(0);
      expect((await detect()).tools.node.installed).toBe(false);
    });
  });
});
