import { connect as tcp } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../app.js';
import { testCtx, testKey } from '../testUtil.js';

// Integration tests: a real PTY on the Docker test VPS (vps-a, 127.0.0.1:2201).
const PORT = 2201;
const reachable = await new Promise<boolean>((ok) => {
  const s = tcp(PORT, '127.0.0.1');
  s.setTimeout(1500, () => (s.destroy(), ok(false)));
  s.on('connect', () => (s.end(), ok(true)));
  s.on('error', () => ok(false));
});
const privateKey = testKey();
const H = { 'x-gfv-token': 't' };
vi.setConfig({ testTimeout: 30_000 });
const WAIT = { timeout: 10_000, interval: 50 };

describe.skipIf(!reachable)('terminal over WebSocket (vps-a)', () => {
  const ctx = testCtx();
  let app: FastifyInstance;
  let serverId: string;

  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: H, payload });

  async function setup() {
    app = await buildApp('t', ctx);
    await app.ready();
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
    expect((await call('POST', `/api/servers/${serverId}/connect`)).json().status).toBe(
      'connected',
    );
  }
  afterAll(async () => {
    ctx.pool.disconnectAll();
    await app?.close();
  });

  async function open(id = () => serverId, query = 'cols=100&rows=30') {
    const ws = await app.injectWS(`/api/terminal/${id()}?${query}`, {
      headers: { ...H, origin: 'http://localhost:5173' },
    });
    const s = { out: '', msgs: [] as { type: string; [k: string]: unknown }[] };
    ws.on('message', (d: Buffer, isBinary: boolean) => {
      if (isBinary) s.out += d.toString('utf8');
      else s.msgs.push(JSON.parse(d.toString()));
    });
    return {
      ws,
      s,
      type: (text: string) => ws.send(Buffer.from(text), { binary: true }),
      ctl: (m: object) => ws.send(JSON.stringify(m)),
    };
  }

  it('runs commands in a real shell and streams the output back', async () => {
    await setup();
    const t = await open();
    t.type('echo $((6*7))\r');
    // "42" only appears as the command's RESULT (the echoed command text contains "6*7").
    await vi.waitFor(() => expect(t.s.out).toMatch(/[\r\n]42\r\n/), WAIT);
    t.ws.terminate();
  });

  it('applies the initial size and later resize messages to the PTY', async () => {
    const t = await open(() => serverId, 'cols=100&rows=30');
    t.type('stty size\r');
    await vi.waitFor(() => expect(t.s.out).toContain('30 100'), WAIT);
    t.ctl({ type: 'resize', cols: 123, rows: 45 });
    t.type('stty size\r');
    await vi.waitFor(() => expect(t.s.out).toContain('45 123'), WAIT);
    t.ws.terminate();
  });

  it('holds the Enter on a dangerous command, and Cancel abandons it', async () => {
    const t = await open();
    t.type('ufw disable\r');
    await vi.waitFor(() => expect(t.s.msgs.some((m) => m.type === 'danger')).toBe(true), WAIT);
    const danger = t.s.msgs.find((m) => m.type === 'danger') as unknown as {
      command: string;
      matches: { id: string }[];
    };
    expect(danger.command).toBe('ufw disable');
    expect(danger.matches[0]?.id).toBe('ufw-off');

    t.type('echo IGNORED\r'); // keystrokes are dropped while the confirmation is pending
    t.ctl({ type: 'danger_decision', action: 'cancel' });

    t.type('echo $((7*6))\r');
    await vi.waitFor(() => expect(t.s.out).toMatch(/[\r\n]42\r\n/), WAIT);
    // Output is ordered: had the Enter been sent, "not found" would have appeared before 42.
    expect(t.s.out).not.toMatch(/not found/i);
    expect(t.s.out).not.toContain('IGNORED');
    t.ws.terminate();
  });

  it('"Run anyway" releases the held Enter', async () => {
    const t = await open();
    t.type('ufw disable\r');
    await vi.waitFor(() => expect(t.s.msgs.some((m) => m.type === 'danger')).toBe(true), WAIT);
    expect(t.s.out).not.toMatch(/not found/i);
    t.ctl({ type: 'danger_decision', action: 'run' });
    await vi.waitFor(() => expect(t.s.out).toMatch(/not found/i), WAIT);
    t.ws.terminate();
  });

  it('does not interrupt harmless commands', async () => {
    const t = await open();
    t.type('echo $((5*5))\r');
    await vi.waitFor(() => expect(t.s.out).toMatch(/[\r\n]25\r\n/), WAIT);
    expect(t.s.msgs.filter((m) => m.type === 'danger')).toEqual([]);
    t.ws.terminate();
  });

  it('runs a full-screen program (htop) and leaves it again', async () => {
    const t = await open();
    t.type('TERM=xterm-256color htop\r');
    await vi.waitFor(() => expect(t.s.out).toContain('\x1b[?1049h'), WAIT); // entered alt screen
    await vi.waitFor(() => expect(t.s.out).toMatch(/CPU|Mem|PID/), WAIT); // htop actually drew
    t.type('q');
    await vi.waitFor(() => expect(t.s.out).toContain('\x1b[?1049l'), WAIT);
    t.ws.terminate();
  });

  it('reports exit when the shell ends', async () => {
    const t = await open();
    t.type('exit\r');
    await vi.waitFor(() => expect(t.s.msgs.some((m) => m.type === 'exit')).toBe(true), WAIT);
  });

  it('tells the browser when the server is not connected', async () => {
    await call('POST', `/api/servers/${serverId}/disconnect`);
    // A real socket (not injectWS): the server replies and closes immediately, and a
    // real client is what the browser is.
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/terminal/${serverId}`, {
      headers: { ...H, origin: 'http://localhost:5173' },
    });
    const msgs: unknown[] = [];
    ws.on(
      'message',
      (d: Buffer, isBinary: boolean) => !isBinary && msgs.push(JSON.parse(d.toString())),
    );
    await new Promise((r) => ws.on('close', r));
    expect(msgs).toEqual([
      { type: 'error', code: 'not_connected', message: 'This server is not connected.' },
    ]);
  });

  it('rejects a foreign Origin', async () => {
    const bad = await app.injectWS(`/api/terminal/${serverId}`, {
      headers: { ...H, origin: 'http://evil.example' },
    });
    await vi.waitFor(() => expect(bad.readyState).toBe(bad.CLOSED), WAIT);
  });
});
