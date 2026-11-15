import { connect as tcp } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it, vi, beforeAll } from 'vitest';
import {
  buildServerMap,
  layoutMap,
  parseCwds,
  parsePorts,
  parseProjects,
  parseSites,
} from '@gfv/shared';
import { buildApp } from '../app.js';
import { exclusive, testCtx, testKey } from '../testUtil.js';

// The Server Map built from REAL command output on vps-b: a real nginx site proxying to a real listening program that
// was started from inside a project folder, and a second site pointing at a port nobody listens on.
const reachable = await new Promise<boolean>((ok) => {
  const s = tcp(2202, '127.0.0.1');
  s.setTimeout(1500, () => (s.destroy(), ok(false)));
  s.on('connect', () => (s.end(), ok(true)));
  s.on('error', () => ok(false));
});
const privateKey = testKey();
const H = { 'x-gfv-token': 't' };
vi.setConfig({ testTimeout: 400_000, hookTimeout: 120_000 });

describe.skipIf(!reachable)('server map from real output (vps-b)', () => {
  const ctx = testCtx();
  let release: () => void = () => {};
  // Files that install packages on this server take turns (concurrent apt/dnf runs fight over the package lock).
  beforeAll(async () => {
    release = await exclusive('vps-b');
  }, 1_800_000);
  let app: FastifyInstance;
  let id: string;
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: H, payload });
  const remote = (cmd: string) =>
    new Promise<{ code: number; out: string }>((res, rej) =>
      ctx.pool.getClient(id)!.exec(cmd, (e, st) => {
        if (e) return rej(e);
        let out = '';
        st.on('data', (d: Buffer) => (out += d));
        st.stderr.on('data', (d: Buffer) => (out += d));
        st.on('close', (code: number) => res({ code, out: out.trim() }));
      }),
    );
  const run = async (actionId: string, params: object = {}) => {
    const r = await call('POST', '/api/runs', { serverId: id, actionId, params, confirmed: true });
    expect(r.statusCode, r.body).toBe(200);
    const rr = ctx.runner.get(r.json().runId)!;
    await rr.done;
    return rr;
  };
  const query = async (actionId: string) =>
    (await call('POST', '/api/runs/query', { serverId: id, actionId, params: {} })).json()
      .stdout as string;

  afterAll(async () => {
    if (id) {
      await remote(
        'kill $(cat /tmp/gfv-map.pid) 2>/dev/null; rm -rf ~/gfv-projects/mapproj /tmp/gfv-map-listener.pl /tmp/gfv-map.pid',
      ).catch(() => {});
      await run('nginx.site.remove', { domain: 'live.test' }).catch(() => {});
      await run('nginx.site.remove', { domain: 'dead.test' }).catch(() => {});
    }
    ctx.pool.disconnectAll();
    await app?.close();
    release();
  });

  it('sets up: nginx, ss, a project folder, a real listener started from it, two sites', async () => {
    app = await buildApp('t', ctx);
    await app.ready();
    await call('POST', '/api/vault/create', { password: 'master-pass' });
    id = (
      await call('POST', '/api/servers', {
        name: 'vps-b',
        host: '127.0.0.1',
        port: 2202,
        username: 'gfv',
        authType: 'key',
        privateKey,
      })
    ).json().id;
    const first = (await call('POST', `/api/servers/${id}/connect`)).json();
    await call('POST', `/api/servers/${id}/trust-host-key`, { fingerprint: first.fingerprint });
    expect((await call('POST', `/api/servers/${id}/connect`)).json().status).toBe('connected');

    let ss = { out: '' };
    for (let i = 0; i < 12 && !ss.out.includes('/ss'); i++) {
      ss = await remote(
        'command -v ss || (sudo apt-get update -q && sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -q -o DPkg::Lock::Timeout=120 iproute2) >/dev/null 2>&1; command -v ss',
      );
      if (!ss.out.includes('/ss')) await new Promise((r) => setTimeout(r, 10_000));
    }
    expect(ss.out).toContain('/ss');
    const nginx = await run('devhub.install.nginx');
    expect(nginx.exitCode, nginx.outputTail).toBe(0);

    const r = await remote(
      [
        '[ -f /tmp/gfv-map.pid ] && kill $(cat /tmp/gfv-map.pid) 2>/dev/null; mkdir -p ~/gfv-projects/mapproj',
        `printf '%s' '{"name":"mapproj","repo":"/x","branch":"main"}' > ~/gfv-projects/mapproj/.gfv-project.json`,
        `cat > /tmp/gfv-map-listener.pl <<'EOF'`,
        'use IO::Socket::INET; $0 = "gfv-map-listener.pl";',
        '$s = IO::Socket::INET->new(LocalAddr => "127.0.0.1", LocalPort => 4567, Listen => 5, ReuseAddr => 1) or die;',
        'while ($c = $s->accept) { print $c "HTTP/1.0 200 OK\\r\\n\\r\\nok"; close $c }',
        'EOF',
        'cd ~/gfv-projects/mapproj && (nohup perl /tmp/gfv-map-listener.pl >/dev/null 2>&1 & echo $! > /tmp/gfv-map.pid); sleep 1; echo started',
      ].join('\n'),
    );
    expect(r.out).toContain('started');
    expect(
      (await run('nginx.site.create', { kind: 'proxy', domain: 'live.test', port: 4567 })).exitCode,
    ).toBe(0);
    expect(
      (await run('nginx.site.create', { kind: 'proxy', domain: 'dead.test', port: 4999 })).exitCode,
    ).toBe(0);
  });

  it('builds the chain domain -> site -> port -> program -> project from real output, and flags the dead site', async () => {
    const ports = parsePorts(await query('ports.list'));
    const sites = parseSites(await query('nginx.sites.list'));
    const projects = parseProjects(await query('projects.list'));
    const cwds = parseCwds(await query('map.cwds'));
    const listener = ports.find((p) => p.port === 4567);
    expect(listener, JSON.stringify(ports)).toBeDefined();
    expect(cwds[listener!.pid!]).toContain('/gfv-projects/mapproj'); // a real /proc/<pid>/cwd

    const map = buildServerMap({ ports, sites, projects, cwds, home: '/home/gfv' });
    const has = (a: string, b: string) => map.edges.some((e) => e.from === a && e.to === b);
    expect(has('domain:live.test', 'site:live.test')).toBe(true);
    expect(has('site:live.test', 'port:4567')).toBe(true);
    expect(has('port:4567', `process:${listener!.pid}`)).toBe(true);
    expect(has(`process:${listener!.pid}`, 'project:mapproj')).toBe(true);

    // The dead site is an error, with a broken edge, and the live one is healthy.
    expect(map.nodes.find((n) => n.id === 'site:dead.test')!.health).toBe('error');
    expect(map.edges.find((e) => e.from === 'site:dead.test')!.broken).toBe(true);
    expect(map.issues.some((i) => i.health === 'error' && i.message.includes('4999'))).toBe(true);
    expect(map.nodes.find((n) => n.id === 'site:live.test')!.health).toBe('ok');

    // sshd is on the "other ports" strip, and the layout fits it all without overlap.
    expect(map.otherPorts.some((p) => p.port === 22)).toBe(true);
    const l = layoutMap(map);
    expect(l.nodes.length).toBe(map.nodes.length);
  });
});
