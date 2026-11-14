import { describe, expect, it } from 'vitest';
import type { ListeningPort, NginxSite } from '../nginx/site.js';
import type { ProjectInfo } from '../projects/project.js';
import {
  NODE_H,
  NODE_W,
  buildServerMap,
  layoutMap,
  parseCwds,
  proxyPort,
  type MapInput,
} from './serverMap.js';

const port = (p: number, process?: string, pid?: number, address = '0.0.0.0'): ListeningPort => ({
  proto: 'tcp',
  address,
  port: p,
  ...(process ? { process, pid } : {}),
});
const site = (name: string, over: Partial<NginxSite> = {}): NginxSite => ({
  name,
  enabled: true,
  serverNames: [name],
  https: false,
  managedByGfv: true,
  ...over,
});
const project = (name: string, over: Partial<ProjectInfo> = {}): ProjectInfo => ({
  name,
  repo: 'r',
  branch: 'main',
  active: 'active',
  hasEnv: false,
  hasUnit: true,
  ...over,
});
const base = (over: Partial<MapInput> = {}): MapInput => ({
  ports: [],
  sites: [],
  projects: [],
  cwds: {},
  home: '/home/gfv',
  ...over,
});
const has = (m: ReturnType<typeof buildServerMap>, from: string, to: string) =>
  m.edges.some((e) => e.from === from && e.to === to);

describe('proxyPort', () => {
  it('reads the local port from a proxy target', () => {
    expect(proxyPort('http://127.0.0.1:3000')).toBe(3000);
    expect(proxyPort('http://localhost:8080/')).toBe(8080);
    expect(proxyPort('https://[::1]:9000/app')).toBe(9000);
  });
  it('is null for anything else', () => {
    expect(proxyPort('http://other.host:3000')).toBeNull();
    expect(proxyPort('/var/www/html')).toBeNull();
    expect(proxyPort('http://127.0.0.1:99999')).toBeNull();
    expect(proxyPort(undefined)).toBeNull();
  });
});

describe('parseCwds', () => {
  it('reads PID lines and ignores noise', () => {
    expect(parseCwds('PID:12:/home/gfv/gfv-projects/web\nPID:13:\nnoise\nPID:14:/srv')).toEqual({
      12: '/home/gfv/gfv-projects/web',
      14: '/srv',
    });
  });
});

describe('buildServerMap: the full chain', () => {
  const m = buildServerMap(
    base({
      ports: [port(80, 'nginx', 5), port(3000, 'node', 77, '127.0.0.1'), port(22, 'sshd', 1)],
      sites: [site('app.example.com', { target: 'http://127.0.0.1:3000', https: true })],
      projects: [project('web')],
      cwds: { 77: '/home/gfv/gfv-projects/web' },
    }),
  );
  it('links domain -> site -> port -> program -> project', () => {
    expect(has(m, 'domain:app.example.com', 'site:app.example.com')).toBe(true);
    expect(has(m, 'site:app.example.com', 'port:3000')).toBe(true);
    expect(has(m, 'port:3000', 'process:77')).toBe(true);
    expect(has(m, 'process:77', 'project:web')).toBe(true);
  });
  it('a healthy chain has no problems, and unrelated ports go to "other ports"', () => {
    expect(
      m.issues.filter((i) => i.health !== 'warn' || true).filter((x) => x.health === 'error'),
    ).toEqual([]);
    expect(m.nodes.find((n) => n.id === 'domain:app.example.com')).toMatchObject({
      health: 'ok',
      sub: 'HTTPS',
    });
    expect(m.otherPorts.map((p) => p.port).sort((a, b) => a - b)).toEqual([22, 80]);
    expect(m.nodes.find((n) => n.id === 'port:3000')!.sub).toBe('this server only');
  });
});

describe('buildServerMap: what is wrong', () => {
  it('a site that proxies to a port nobody listens on is an ERROR on the site and the port, with a broken edge', () => {
    const m = buildServerMap(
      base({
        ports: [port(22, 'sshd', 1)],
        sites: [site('dead.example.com', { target: 'http://127.0.0.1:4999' })],
      }),
    );
    expect(m.nodes.find((n) => n.id === 'port:4999')).toMatchObject({
      health: 'error',
      sub: 'nothing listening',
    });
    expect(m.nodes.find((n) => n.id === 'site:dead.example.com')!.health).toBe('error');
    expect(m.edges.find((e) => e.to === 'port:4999')!.broken).toBe(true);
    expect(m.issues.some((i) => i.health === 'error' && i.message.includes('4999'))).toBe(true);
  });
  it('a disabled site, a failed service and a stopped one are flagged', () => {
    const m = buildServerMap(
      base({
        sites: [site('off.com', { enabled: false, target: '/var/www' })],
        projects: [project('a', { active: 'failed' }), project('b', { active: 'inactive' })],
      }),
    );
    expect(m.nodes.find((n) => n.id === 'site:off.com')!.health).toBe('warn');
    expect(m.nodes.find((n) => n.id === 'project:a')!.health).toBe('error');
    expect(m.nodes.find((n) => n.id === 'project:b')!.health).toBe('warn');
  });
  it('missing HTTPS and a project behind its repository are only information (not problems)', () => {
    const m = buildServerMap(
      base({
        sites: [site('plain.example.com', { target: '/srv' })],
        projects: [project('p', { behind: 3, hasUnit: false })],
      }),
    );
    expect(m.nodes.find((n) => n.id === 'domain:plain.example.com')).toMatchObject({
      health: 'info',
    });
    expect(m.issues).toEqual([]); // info never appears in the problems list
    expect(m.nodes.find((n) => n.id === 'project:p')!.note).toContain('behind');
  });
  it('the worst state wins', () => {
    const m = buildServerMap(
      base({ sites: [site('x.com', { enabled: false, target: 'http://127.0.0.1:1' })] }),
    );
    expect(m.nodes.find((n) => n.id === 'site:x.com')!.health).toBe('error'); // disabled (warn) AND dead target (error)
  });
});

describe('buildServerMap: other shapes', () => {
  it('a static site points at its folder; the catch-all "_" is not shown as a domain', () => {
    const m = buildServerMap(
      base({ sites: [site('default', { serverNames: ['_'], target: '/var/www/html' })] }),
    );
    expect(m.nodes.some((n) => n.kind === 'domain')).toBe(false);
    expect(has(m, 'site:default', 'folder:/var/www/html')).toBe(true);
  });
  it('a proxy to another machine is a plain target, not a missing port', () => {
    const m = buildServerMap(base({ sites: [site('p.com', { target: 'http://10.0.0.5:3000' })] }));
    expect(m.nodes.find((n) => n.id === 'folder:http://10.0.0.5:3000')).toMatchObject({
      sub: 'other machine',
    });
    expect(m.issues).toEqual([]);
  });
  it('two domains on one site, and two sites on one port, share nodes', () => {
    const m = buildServerMap(
      base({
        ports: [port(3000, 'node', 9)],
        sites: [
          site('a.com', { serverNames: ['a.com', 'www.a.com'], target: 'http://127.0.0.1:3000' }),
          site('b.com', { target: 'http://127.0.0.1:3000' }),
        ],
      }),
    );
    expect(m.nodes.filter((n) => n.kind === 'port')).toHaveLength(1);
    expect(m.edges.filter((e) => e.to === 'port:3000')).toHaveLength(2);
    expect(m.nodes.filter((n) => n.kind === 'domain')).toHaveLength(3);
  });
  it('a program with an unknown owner (no sudo) still shows the port', () => {
    const m = buildServerMap(
      base({ ports: [port(3000)], sites: [site('a.com', { target: 'http://127.0.0.1:3000' })] }),
    );
    expect(m.nodes.some((n) => n.kind === 'process')).toBe(false);
    expect(m.nodes.find((n) => n.id === 'port:3000')!.health).toBe('ok');
  });
  it('a project program with no site yet is still mapped', () => {
    const m = buildServerMap(
      base({
        ports: [port(5000, 'node', 8)],
        projects: [project('api')],
        cwds: { 8: '/home/gfv/gfv-projects/api/dist' },
      }),
    );
    expect(has(m, 'process:8', 'project:api')).toBe(true);
    expect(m.otherPorts).toEqual([]);
  });
  it('is empty for an empty server', () => {
    expect(buildServerMap(base())).toEqual({ nodes: [], edges: [], issues: [], otherPorts: [] });
  });
});

describe('layoutMap', () => {
  const m = buildServerMap(
    base({
      ports: [port(3000, 'node', 77), port(4000, 'go', 78)],
      sites: [
        site('a.com', { target: 'http://127.0.0.1:3000' }),
        site('b.com', { serverNames: ['b.com', 'www.b.com'], target: 'http://127.0.0.1:4000' }),
        site('s.com', { target: '/srv' }),
      ],
      projects: [project('web'), project('api')],
      cwds: { 77: '/home/gfv/gfv-projects/web', 78: '/home/gfv/gfv-projects/api' },
    }),
  );
  const l = layoutMap(m);
  it('places every node exactly once, with no overlaps', () => {
    expect(l.nodes).toHaveLength(m.nodes.length);
    for (let i = 0; i < l.nodes.length; i++)
      for (let j = i + 1; j < l.nodes.length; j++) {
        const a = l.nodes[i]!;
        const b = l.nodes[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.id} vs ${b.id}`).toBe(false);
      }
  });
  it('puts kinds in columns from left (domains) to right (projects)', () => {
    const x = (k: string) => l.nodes.find((n) => n.kind === k)!.x;
    expect(x('domain')).toBeLessThan(x('site'));
    expect(x('site')).toBeLessThan(x('port'));
    expect(x('port')).toBeLessThan(x('process'));
    expect(x('process')).toBeLessThan(x('project'));
  });
  it('keeps connected chains on the same row where it can, and fits inside the reported size', () => {
    const y = (id: string) => l.nodes.find((n) => n.id === id)!.y;
    expect(y('site:a.com')).toBe(y('domain:a.com'));
    expect(y('port:3000')).toBe(y('process:77'));
    for (const n of l.nodes) {
      expect(n.x + n.w).toBeLessThanOrEqual(l.width);
      expect(n.y + n.h).toBeLessThanOrEqual(l.height);
      expect(n.w).toBe(NODE_W);
      expect(n.h).toBe(NODE_H);
    }
  });
  it('is deterministic', () => {
    expect(layoutMap(m)).toEqual(l);
  });
  it('an empty map has no size', () => {
    expect(layoutMap(buildServerMap(base()))).toEqual({
      nodes: [],
      width: expect.any(Number),
      height: 0,
    });
  });
});
