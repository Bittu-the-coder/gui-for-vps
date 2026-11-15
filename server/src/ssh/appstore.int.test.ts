import { execFileSync, execSync } from 'node:child_process';
import { connect as tcp } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { APPS, parseCredentials, parseInstalled } from '@gfv/shared';
import { buildApp } from '../app.js';
import { exclusive, testCtx, testKey } from '../testUtil.js';

// The App Store on a REAL server: real systemd, real Docker (installed through the Dev Hub), real images.
//   docker compose -f e2e/docker-compose.yml --profile systemd up -d --build vps-systemd
const up = await new Promise<boolean>((ok) => {
  const s = tcp(2204, '127.0.0.1');
  s.setTimeout(1500, () => (s.destroy(), ok(false)));
  s.on('connect', () => (s.end(), ok(true)));
  s.on('error', () => ok(false));
});
const privateKey = testKey();
const H = { 'x-gfv-token': 't' };
vi.setConfig({ testTimeout: 900_000, hookTimeout: 60_000 });

// No host shell in between: `$a` and `$1` must reach the container untouched.
const box = (cmd: string) =>
  execFileSync('docker', ['exec', 'gfv-vps-systemd', 'sh', '-c', cmd], { encoding: 'utf8' }).trim();
const boxIp = () => box("hostname -I | awk '{print $1}'");
const hostCurl = (url: string) => {
  try {
    return execSync(`curl -s -m 5 ${url}`, { encoding: 'utf8' });
  } catch {
    return '';
  }
};

describe.skipIf(!up)('App Store (real Docker on real systemd)', () => {
  const ctx = testCtx();
  let release: () => void = () => {};
  beforeAll(async () => {
    release = await exclusive('systemd');
  }, 1_800_000);
  let app: FastifyInstance;
  let id: string;
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: H, payload });
  const run = async (actionId: string, params: object = {}) => {
    const r = await call('POST', '/api/runs', { serverId: id, actionId, params, confirmed: true });
    expect(r.statusCode, r.body).toBe(200);
    const rr = ctx.runner.get(r.json().runId)!;
    await rr.done;
    return { run: rr, text: rr.outputTail };
  };
  const listing = async () => {
    const q = await ctx.runner.query(id, 'apps.list', {});
    if (!q.ok) throw new Error(JSON.stringify(q));
    return parseInstalled(q.stdout);
  };
  const installed = async (appId: string) => {
    const l = await listing();
    return l.kind === 'ok' ? l.apps.find((a) => a.id === appId) : undefined;
  };
  const creds = async (appId: string) => {
    const q = await ctx.runner.query(id, 'apps.credentials', { app: appId });
    if (!q.ok) throw new Error('credentials');
    return parseCredentials(
      q.stdout,
      APPS.find((a) => a.id === appId)!,
    );
  };
  const wipe = () => {
    try {
      box(
        'for a in whoami redis postgres; do docker rm -f gfv-$a >/dev/null 2>&1; docker volume rm gfv-$a-data >/dev/null 2>&1; done; rm -rf /home/gfv/.gfv/apps',
      );
    } catch {
      /* docker not installed yet */
    }
  };
  afterAll(async () => {
    wipe();
    ctx.pool.disconnectAll();
    await app?.close();
    release();
  });

  it('connects; with no Docker the list says so, then Dev Hub installs it for real', async () => {
    box(
      'systemctl stop docker docker.socket >/dev/null 2>&1; apt-get remove -y -q docker.io >/dev/null 2>&1; true',
    );
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

    expect((await listing()).kind).toBe('no_docker');
    const refused = await run('apps.install', { app: 'whoami', hostPort: 18081, expose: false });
    expect(refused.run.exitCode).not.toBe(0);
    expect(refused.text).toContain('Docker is not installed');

    const dk = await run('devhub.install.docker');
    expect(dk.run.exitCode, dk.text).toBe(0);
    expect(box('systemctl is-active docker')).toBe('active'); // REAL systemd: the daemon really runs
    expect((await listing()).kind).toBe('ok');
  });

  it('installs whoami bound to the server only: reachable from inside, NOT from outside', async () => {
    const r = await run('apps.install', { app: 'whoami', hostPort: 18081, expose: false });
    expect(r.run.exitCode, r.text).toBe(0);
    const a = await installed('whoami');
    expect(a).toMatchObject({ state: 'running', hostPort: 18081, exposed: false });
    expect(box('curl -s -m 5 127.0.0.1:18081')).toContain('Hostname:');
    expect(hostCurl(`http://${boxIp()}:18081`)).toBe(''); // 127.0.0.1 binding: the network cannot reach it
    expect(box('docker inspect -f "{{.HostConfig.RestartPolicy.Name}}" gfv-whoami')).toBe(
      'unless-stopped',
    );
  });

  it('refuses to install the same app twice, and stop / start work through the Docker actions', async () => {
    const again = await run('apps.install', { app: 'whoami', hostPort: 18082, expose: false });
    expect(again.run.exitCode).not.toBe(0);
    expect(again.text).toContain('already installed');
    expect((await run('docker.stop', { name: 'gfv-whoami' })).run.exitCode).toBe(0);
    expect((await installed('whoami'))?.state).toBe('stopped');
    expect((await run('docker.start', { name: 'gfv-whoami' })).run.exitCode).toBe(0);
    expect((await installed('whoami'))?.state).toBe('running');
  });

  it('exposing an app really opens it to the network', async () => {
    expect((await run('apps.remove', { app: 'whoami', deleteData: false })).run.exitCode).toBe(0);
    expect(await installed('whoami')).toBeUndefined();
    const r = await run('apps.install', { app: 'whoami', hostPort: 18081, expose: true });
    expect(r.run.exitCode, r.text).toBe(0);
    expect(await installed('whoami')).toMatchObject({ exposed: true });
    expect(hostCurl(`http://${boxIp()}:18081`)).toContain('Hostname:');
  });

  it('Redis needs its generated password, which is stored privately and never in history', async () => {
    const r = await run('apps.install', { app: 'redis', hostPort: 16380, expose: false });
    expect(r.run.exitCode, r.text).toBe(0);
    const value = (await creds('redis'))[0]!.value;
    expect(value).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(box('stat -c %a /home/gfv/.gfv/apps/redis.env')).toBe('600');
    for (
      let i = 0;
      i < 20 && !box('docker exec gfv-redis redis-cli ping 2>&1 || true').includes('NOAUTH');
      i++
    )
      await new Promise((res) => setTimeout(res, 1000));
    expect(box('docker exec gfv-redis redis-cli ping 2>&1 || true')).toContain('NOAUTH');
    expect(box(`docker exec gfv-redis redis-cli -a ${value} --no-auth-warning ping`)).toBe('PONG');
    // The password never appears in the stored history (commands, params, output).
    const hist = (await call('GET', '/api/history?limit=100')).body;
    expect(hist).not.toContain(value);
  });

  it('PostgreSQL starts with its generated password and accepts a real query', async () => {
    const r = await run('apps.install', { app: 'postgres', hostPort: 15433, expose: false });
    expect(r.run.exitCode, r.text).toBe(0);
    const value = (await creds('postgres'))[0]!.value;
    let out = '';
    for (let i = 0; i < 30 && !out.includes('42'); i++) {
      await new Promise((res) => setTimeout(res, 2000));
      out = box(
        `docker exec -e PGPASSWORD=${value} gfv-postgres psql -h 127.0.0.1 -U postgres -tAc 'select 6*7' 2>&1 || true`,
      );
    }
    expect(out).toContain('42');
  });

  it('removing keeps the data unless you say otherwise, and "delete data" really deletes it', async () => {
    expect((await run('apps.remove', { app: 'postgres', deleteData: false })).run.exitCode).toBe(0);
    expect(box('docker volume ls -q')).toContain('gfv-postgres-data');
    expect(box('ls /home/gfv/.gfv/apps')).toContain('postgres.env');
    // Danger: the server asks for confirmation.
    const noConfirm = await call('POST', '/api/runs', {
      serverId: id,
      actionId: 'apps.remove',
      params: { app: 'postgres', deleteData: true },
    });
    expect(noConfirm.statusCode).toBe(403);
    expect((await run('apps.remove', { app: 'postgres', deleteData: true })).run.exitCode).toBe(0);
    expect(box('docker volume ls -q')).not.toContain('gfv-postgres-data');
    expect(box('ls /home/gfv/.gfv/apps')).not.toContain('postgres.env');
  });

  it('refuses a hostile app id or port before anything reaches the server', async () => {
    for (const params of [
      { app: 'whoami; reboot', hostPort: 18090, expose: false },
      { app: 'whoami', hostPort: 22, expose: false },
    ]) {
      const r = await call('POST', '/api/runs', {
        serverId: id,
        actionId: 'apps.install',
        params,
        confirmed: true,
      });
      expect(r.statusCode).toBe(400);
    }
  });
});
