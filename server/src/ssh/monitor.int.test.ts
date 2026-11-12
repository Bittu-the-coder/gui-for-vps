import { readFileSync } from 'node:fs';
import { connect as tcp } from 'node:net';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  cpuPercent,
  parseContainers,
  parseImages,
  parseProcesses,
  parseSample,
  parseServices,
} from '@gfv/shared';
import { buildApp } from '../app.js';
import { testCtx } from '../testUtil.js';

// Integration: quiet queries + M6 actions against the Docker test VPS (vps-a). systemctl, journalctl
// and docker there are SHIMS (canned output), but /proc, ps and df are real.
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

describe.skipIf(!reachable)('monitor, services, docker (vps-a)', () => {
  const ctx = testCtx();
  let app: FastifyInstance;
  let id: string;

  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: H, payload });
  const query = (actionId: string, params: object = {}) =>
    call('POST', '/api/runs/query', { serverId: id, actionId, params });

  afterAll(async () => {
    ctx.pool.disconnectAll();
    await app?.close();
  });

  it('sets up', async () => {
    app = await buildApp('t', ctx);
    await app.ready();
    await call('POST', '/api/vault/create', { password: 'master-pass' });
    id = (
      await call('POST', '/api/servers', {
        name: 'vps-a',
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

  it('detects sudo for a non-root user and shows it in the preview', async () => {
    expect(await ctx.runner.ctxFor(id)).toEqual({ sudo: 'sudo -n ' });
    const r = await call('POST', '/api/runs/preview', {
      serverId: id,
      actionId: 'service.restart',
      params: { unit: 'nginx.service' },
    });
    expect(r.json().commands).toEqual(['sudo -n systemctl restart nginx.service']);
  });

  it('the real sampler output parses, and two samples give a sane CPU %', async () => {
    const a = await query('monitor.sample');
    expect(a.statusCode).toBe(200);
    const s1 = parseSample(a.json().stdout);
    expect(s1.mem.total).toBeGreaterThan(0);
    expect(s1.cpus).toBeGreaterThanOrEqual(1);
    expect(s1.disks.length).toBeGreaterThan(0);
    expect(s1.os).toMatch(/Ubuntu/);
    expect(s1.uptimeSec).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 300));
    const s2 = parseSample((await query('monitor.sample')).json().stdout);
    const pct = cpuPercent(s1, s2);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });

  it('lists real processes', async () => {
    const procs = parseProcesses((await query('monitor.processes')).json().stdout);
    expect(procs.some((p) => p.name === 'sshd')).toBe(true);
    expect(procs.some((p) => p.pid === 1)).toBe(true);
  });

  it('lists services and logs (shims)', async () => {
    const svc = parseServices((await query('services.list')).json().stdout);
    expect(svc.map((s) => s.unit)).toEqual([
      'broken.service',
      'cron.service',
      'nginx.service',
      'ssh.service',
    ]);
    expect(svc.find((s) => s.unit === 'broken.service')).toMatchObject({
      active: 'failed',
      boot: 'disabled',
    });
    const logs = (await query('services.logs', { unit: 'nginx.service' })).json();
    expect(logs.exitCode).toBe(0);
    expect(logs.stdout).toContain('handled request');
  });

  it('lists containers and images (shims)', async () => {
    const c = parseContainers((await query('docker.list')).json().stdout);
    expect(c.map((x) => [x.name, x.state])).toEqual([
      ['web', 'running'],
      ['db', 'exited'],
    ]);
    expect(parseImages((await query('docker.images')).json().stdout)).toHaveLength(2);
    expect((await query('docker.logs', { name: 'web' })).json().stdout).toContain('web');
  });

  it('refuses to run anything that is not a quiet query, and bad params', async () => {
    const r = await query('service.restart', { unit: 'nginx.service' });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('not_quiet');
    expect((await query('services.logs', { unit: 'nope' })).statusCode).toBe(400);
    expect((await query('nope')).statusCode).toBe(404);
  });

  it('mutating actions still need confirmation and then run through the normal runner', async () => {
    const body = { serverId: id, actionId: 'service.restart', params: { unit: 'nginx.service' } };
    expect((await call('POST', '/api/runs', body)).statusCode).toBe(403);
    const ok = await call('POST', '/api/runs', { ...body, confirmed: true });
    const run = ctx.runner.get(ok.json().runId)!;
    await run.done;
    expect(run.exitCode).toBe(0);
    expect(run.outputTail).toContain('systemctl restart nginx.service');
    // ssh.service is a lock-out risk: the preview says danger
    const p = await call('POST', '/api/runs/preview', {
      serverId: id,
      actionId: 'service.stop',
      params: { unit: 'ssh.service' },
    });
    expect(p.json().risk).toBe('danger');
  });
});
