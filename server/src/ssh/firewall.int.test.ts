import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect as tcp } from 'node:net';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseBackups, parseStatus } from '@gfv/shared';
import { buildApp } from '../app.js';
import { exclusive, testCtx } from '../testUtil.js';

// Firewall + lockout protection on a REAL server: Ubuntu with real systemd and real ufw (vps-systemd, port 2204):
//   docker compose -f e2e/docker-compose.yml --profile systemd up -d --build vps-systemd
// The firewall here filters the container's own network, so a rule that blocks SSH really does lock GFV out.
const up = await new Promise<boolean>((ok) => {
  const s = tcp(2204, '127.0.0.1');
  s.setTimeout(1500, () => (s.destroy(), ok(false)));
  s.on('connect', () => (s.end(), ok(true)));
  s.on('error', () => ok(false));
});
const privateKey = readFileSync(resolve(__dirname, '../../../e2e/keys/id_test'), 'utf8');
const H = { 'x-gfv-token': 't' };
vi.setConfig({ testTimeout: 300_000, hookTimeout: 60_000 });

/** Root shell inside the test server: sees the truth even while the firewall blocks new SSH connections. */
const box = (cmd: string) =>
  execSync(`docker exec gfv-vps-systemd sh -c ${JSON.stringify(cmd)}`, { encoding: 'utf8' }).trim();

describe.skipIf(!up)('firewall and lockout protection (real ufw, real systemd)', () => {
  const ctx = testCtx();
  let release: () => void = () => {};
  // These two files share one server (its firewall and sshd): never at the same time.
  beforeAll(async () => {
    release = await exclusive('systemd');
  }, 1_200_000);
  let app: FastifyInstance;
  let id: string;
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: H, payload });
  const run = async (actionId: string, params: object = {}) => {
    const r = await call('POST', '/api/runs', { serverId: id, actionId, params, confirmed: true });
    expect(r.statusCode, r.body).toBe(200);
    const rr = ctx.runner.get(r.json().runId)!;
    await rr.done;
    const done = rr.messages.find((m) => m.type === 'done');
    return { run: rr, runId: r.json().runId as string, done, text: rr.outputTail };
  };
  const status = async () => {
    const q = await ctx.runner.query(id, 'firewall.status', {});
    if (!q.ok) throw new Error(JSON.stringify(q));
    return parseStatus(q.stdout);
  };
  const ufw = () => box('ufw status');

  afterAll(async () => {
    try {
      box('ufw --force reset >/dev/null 2>&1; rm -rf /home/gfv/.gfv/guard');
    } catch {
      /* container gone */
    }
    ctx.pool.disconnectAll();
    await app?.close();
    release();
  });

  it('connects, and learns the SSH port and GFV address the way the SERVER sees them', async () => {
    box('ufw --force reset >/dev/null 2>&1; rm -rf /home/gfv/.gfv/guard');
    app = await buildApp('t', ctx);
    await app.ready();
    await call('POST', '/api/vault/create', { password: 'master-pass' });
    id = (
      await call('POST', '/api/servers', {
        name: 'systemd',
        host: '127.0.0.1',
        port: 2204,
        username: 'gfv',
        authType: 'key',
        privateKey,
      })
    ).json().id;
    const first = (await call('POST', `/api/servers/${id}/connect`)).json();
    await call('POST', `/api/servers/${id}/trust-host-key`, { fingerprint: first.fingerprint });
    expect((await call('POST', `/api/servers/${id}/connect`)).json().status).toBe('connected');
    const c = await ctx.runner.ctxFor(id);
    expect(c.sshPort).toBe(22); // not 2204: that is only the port Docker maps on the host
    expect(c.clientIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it('shows the firewall as installed but off; a new connection probe works', async () => {
    const s = await status();
    expect(s).toMatchObject({ installed: true, active: false });
    expect(await ctx.pool.probe(id)).toBe(true);
  });

  it('turning the firewall on allows SSH first, is confirmed by a fresh connection, and keeps an undo point', async () => {
    const r = await run('firewall.enable');
    expect(r.run.exitCode, r.text).toBe(0);
    expect(r.text).toContain('Confirmed');
    expect(ufw()).toContain('Status: active');
    expect(ufw()).toMatch(/22\/tcp\s+ALLOW/);
    expect(box(`ls /home/gfv/.gfv/guard/${r.runId}`)).toMatch(/ok/);
    expect(box(`ls /home/gfv/.gfv/guard/${r.runId}`)).not.toMatch(/reverted/);
    const s = await status();
    expect(s.active).toBe(true);
    expect(s.rules.some((x) => x.port === '22' && x.policy === 'allow')).toBe(true);
  });

  it('adds and removes a rule; the undo list names every change', async () => {
    expect((await run('firewall.allow', { policy: 'allow', port: '8080' })).run.exitCode).toBe(0);
    expect((await status()).rules.some((x) => x.port === '8080')).toBe(true);
    expect((await run('firewall.delete', { policy: 'allow', port: '8080' })).run.exitCode).toBe(0);
    expect((await status()).rules.some((x) => x.port === '8080')).toBe(false);
    const q = await ctx.runner.query(id, 'firewall.backups', {});
    if (!q.ok) throw new Error('backups');
    const b = parseBackups(q.stdout);
    expect(b.length).toBeGreaterThanOrEqual(3);
    expect(b.every((x) => x.confirmed && !x.reverted)).toBe(true);
    expect(b.map((x) => x.title)).toContain('Remove a firewall rule');
  });

  it('undo puts the rules back the way they were before that change (and is itself undoable)', async () => {
    const add = await run('firewall.allow', { policy: 'allow', port: '9090' });
    expect(ufw()).toContain('9090/tcp');
    const undo = await run('firewall.restore', { backup: add.runId });
    expect(undo.run.exitCode, undo.text).toBe(0);
    expect(ufw()).not.toContain('9090/tcp');
    expect(ufw()).toMatch(/22\/tcp\s+ALLOW/); // the rest is untouched
    // Undoing the undo brings the rule back.
    const redo = await run('firewall.restore', { backup: undo.runId });
    expect(redo.run.exitCode, redo.text).toBe(0);
    expect(ufw()).toContain('9090/tcp');
    await run('firewall.delete', { policy: 'allow', port: '9090' });
  });

  it('a rule that locks GFV out is detected and the SERVER undoes it by itself', async () => {
    // "deny 22" goes to the top, so new SSH connections are dropped at once.
    const r = await run('firewall.allow', { policy: 'deny', port: '22' });
    expect(r.done).toMatchObject({ type: 'done', exitCode: 1, reverted: true });
    expect(r.text).toContain('can no longer open a new connection');
    expect(r.text).toContain('The server undid the change');
    // The truth, from inside the box: the deny rule is gone, SSH is allowed again, a marker says why.
    expect(ufw()).not.toMatch(/22\/tcp\s+DENY/);
    expect(ufw()).toMatch(/22\/tcp\s+ALLOW/);
    expect(box(`ls /home/gfv/.gfv/guard/${r.runId}`)).toMatch(/reverted/);
    expect(box(`ls /home/gfv/.gfv/guard/${r.runId}`)).not.toMatch(/\bok\b/);
    expect(await ctx.pool.probe(id)).toBe(true);
  });

  it('removing the only SSH allow rule is caught the same way', async () => {
    const r = await run('firewall.delete', { policy: 'allow', port: '22' });
    expect(r.done).toMatchObject({ type: 'done', exitCode: 1, reverted: true });
    expect(ufw()).toMatch(/22\/tcp\s+ALLOW/);
    expect(await ctx.pool.probe(id)).toBe(true);
    const q = await ctx.runner.query(id, 'firewall.backups', {});
    if (!q.ok) throw new Error('backups');
    expect(parseBackups(q.stdout).find((x) => x.id === r.runId)).toMatchObject({
      reverted: true,
      confirmed: false,
    });
  });

  it('the server asks for confirmation on the dangerous change (the Safety Net is server-side)', async () => {
    const r = await call('POST', '/api/runs', {
      serverId: id,
      actionId: 'firewall.allow',
      params: { policy: 'deny', port: '22' },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().risk).toBe('danger');
  });

  it('turning it off works, and an invalid rule never reaches the server', async () => {
    expect((await run('firewall.disable')).run.exitCode).toBe(0);
    expect(ufw()).toContain('Status: inactive');
    const bad = await call('POST', '/api/runs', {
      serverId: id,
      actionId: 'firewall.allow',
      params: { policy: 'allow', port: '80; reboot' },
      confirmed: true,
    });
    expect(bad.statusCode).toBe(400);
  });
});
