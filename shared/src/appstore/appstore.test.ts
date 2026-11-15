import { describe, expect, it } from 'vitest';
import { previewAction } from '../actions/index.js';
import { APPS, containerName, installSchema, parseCredentials, parseInstalled } from './catalog.js';

const ctx = { sudo: 'sudo -n ', home: '/home/gfv', user: 'gfv' };

describe('the catalog', () => {
  it('has unique ids and sane ports, and every image is pinned (never latest)', () => {
    expect(new Set(APPS.map((a) => a.id)).size).toBe(APPS.length);
    for (const a of APPS) {
      expect(a.id, a.id).toMatch(/^[a-z0-9-]+$/);
      expect(a.image, a.id).toMatch(/:[A-Za-z0-9._-]+$/);
      expect(a.image, a.id).not.toMatch(/:latest$/);
      expect(a.defaultHostPort).toBeGreaterThanOrEqual(1024);
      expect(a.secrets.every((s) => /^[A-Z0-9_]+$/.test(s))).toBe(true);
    }
  });
  it('apps with a password get a generated one and never a fixed one', () => {
    for (const a of APPS.filter((x) => x.secrets.length))
      for (const k of a.secrets) expect(a.env?.[k]).toBeUndefined();
  });
});

describe('installing', () => {
  const run = (params: object) => {
    const p = previewAction('apps.install', params, ctx);
    if (!p.ok) throw new Error('preview failed');
    return p.preview.commands;
  };
  it('binds to 127.0.0.1 unless the person chose to expose it', () => {
    expect(run({ app: 'uptime-kuma', hostPort: 3001, expose: false }).join('\n')).toContain(
      '-p 127.0.0.1:3001:3001',
    );
    expect(run({ app: 'uptime-kuma', hostPort: 3001, expose: true }).join('\n')).toContain(
      '-p 0.0.0.0:3001:3001',
    );
  });
  it('never puts a password in a command: it is generated on the server into a private file', () => {
    const c = run({ app: 'postgres', hostPort: 5433, expose: false });
    const all = c.join('\n');
    expect(all).toContain('umask 077');
    expect(all).toContain('/dev/urandom');
    expect(all).toContain('--env-file "$HOME/.gfv/apps/postgres.env"');
    expect(all).not.toMatch(/POSTGRES_PASSWORD=[A-Za-z0-9]{8,}/);
    // The redis password is expanded INSIDE the container by sh -c, not on the host command line.
    expect(run({ app: 'redis', hostPort: 6380, expose: false }).join('\n')).toContain(
      '--requirepass "$REDIS_PASSWORD"',
    );
  });
  it('refuses to install twice, and checks that Docker is there and running', () => {
    const all = run({ app: 'whoami', hostPort: 8081, expose: false }).join('\n');
    expect(all).toContain('already installed');
    expect(all).toContain('Docker is not installed');
    expect(all).toContain('docker info');
  });
  it('validates the parameters', () => {
    for (const bad of [
      { app: 'nope', hostPort: 8080, expose: false },
      { app: 'redis', hostPort: 80, expose: false },
      { app: 'redis', hostPort: 70000, expose: false },
      { app: 'redis', hostPort: 6380 },
      { app: 'redis; reboot', hostPort: 6380, expose: false },
    ])
      expect(installSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
  it('deleting the data is danger, keeping it is not', () => {
    const keep = previewAction('apps.remove', { app: 'redis', deleteData: false }, ctx);
    const wipe = previewAction('apps.remove', { app: 'redis', deleteData: true }, ctx);
    expect(keep.ok && keep.preview.risk).toBe('caution');
    expect(wipe.ok && wipe.preview.risk).toBe('danger');
    expect(wipe.ok && wipe.preview.commands.join('\n')).toContain(
      'docker volume rm gfv-redis-data',
    );
  });
});

describe('reading back', () => {
  it('parses the listing', () => {
    const r = parseInstalled(
      'uptime-kuma|gfv-uptime-kuma|running|Up 2 hours|louislam/uptime-kuma:1|127.0.0.1:3001->3001/tcp\n' +
        'redis|gfv-redis|exited|Exited (0) 1 minute ago|redis:7-alpine|\n' +
        'other|x|running|Up|img|\n',
    );
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.apps).toHaveLength(2); // unknown ids are ignored
    expect(r.apps[0]).toMatchObject({
      id: 'uptime-kuma',
      state: 'running',
      hostPort: 3001,
      exposed: false,
    });
    expect(r.apps[1]).toMatchObject({ id: 'redis', state: 'stopped', exposed: false });
    expect(parseInstalled('0.0.0.0:8081->80/tcp').kind).toBe('ok');
    expect(parseInstalled('NO_DOCKER').kind).toBe('no_docker');
    expect(parseInstalled('DOCKER_DOWN').kind).toBe('docker_down');
  });
  it('exposed means listening on every address', () => {
    const r = parseInstalled(
      'whoami|gfv-whoami|running|Up|traefik/whoami:v1.10.3|0.0.0.0:8081->80/tcp, [::]:8081->80/tcp',
    );
    expect(r.kind === 'ok' && r.apps[0]).toMatchObject({ exposed: true, hostPort: 8081 });
  });
  it('only the generated secrets are shown as credentials', () => {
    const redis = APPS.find((a) => a.id === 'redis')!;
    expect(parseCredentials('REDIS_PASSWORD=abc123\nOTHER=zzz\n', redis)).toEqual([
      { name: 'REDIS_PASSWORD', value: 'abc123' },
    ]);
    expect(containerName('redis')).toBe('gfv-redis');
  });
});
