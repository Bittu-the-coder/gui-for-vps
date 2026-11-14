import { describe, expect, it } from 'vitest';
import { previewAction } from '../actions/index.js';
import { parsePorts, parseSites, renderSite, sitePaths, siteSchema } from './site.js';

describe('site validation (nothing that carries nginx syntax gets in)', () => {
  const ok = (v: unknown) => siteSchema.safeParse(v).success;
  it('accepts normal domains, ports and folders', () => {
    expect(ok({ kind: 'proxy', domain: 'example.com', port: 3000 })).toBe(true);
    expect(ok({ kind: 'proxy', domain: 'my-app.sub.example.co.uk', port: 65535 })).toBe(true);
    expect(ok({ kind: 'static', domain: 'a.io', root: '/var/www/my_site-1.0' })).toBe(true);
  });
  it('rejects anything that could become a directive', () => {
    for (const domain of [
      'a.com; return 301 http://evil;',
      'a.com\nlisten 1',
      'a b.com',
      'A.com',
      '-a.com',
      'a..com',
      '{a}.com',
      '$x.com',
      "a.com'",
      '',
      '*.a.com',
    ])
      expect(ok({ kind: 'proxy', domain, port: 80 }), domain).toBe(false);
    for (const root of [
      '/var/www;',
      '/var/www/..',
      '/a b',
      'relative',
      '/a\n/b',
      '/a{b}',
      '/a$b',
      '/a"b',
    ])
      expect(ok({ kind: 'static', domain: 'a.com', root }), root).toBe(false);
    for (const port of [0, 65536, 1.5, -1, NaN])
      expect(ok({ kind: 'proxy', domain: 'a.com', port })).toBe(false);
  });
});

describe('renderSite', () => {
  it('a proxy site forwards to the local port with the usual headers', () => {
    const t = renderSite({ kind: 'proxy', domain: 'example.com', port: 3000 });
    expect(t).toContain('server_name example.com;');
    expect(t).toContain('proxy_pass http://127.0.0.1:3000;');
    expect(t).toContain('proxy_set_header X-Forwarded-Proto $scheme;');
    expect(t.startsWith('# Managed by GFV')).toBe(true);
    // Balanced braces: every block that opens, closes.
    expect(t.split('{').length).toBe(t.split('}').length);
  });
  it('a static site serves a folder', () => {
    const t = renderSite({ kind: 'static', domain: 'blog.example.com', root: '/var/www/blog' });
    expect(t).toContain('root /var/www/blog;');
    expect(t).toContain('try_files $uri $uri/ =404;');
  });
});

describe('sitePaths', () => {
  it('Debian-family: sites-available plus a link; Fedora-family: conf.d', () => {
    expect(sitePaths('a.com', 'apt')).toEqual({
      file: '/etc/nginx/sites-available/a.com',
      link: '/etc/nginx/sites-enabled/a.com',
    });
    expect(sitePaths('a.com', undefined).link).toBe('/etc/nginx/sites-enabled/a.com');
    expect(sitePaths('a.com', 'dnf')).toEqual({ file: '/etc/nginx/conf.d/a.com.conf', link: null });
  });
});

describe('parsePorts', () => {
  const ss = [
    'tcp   LISTEN 0      128          0.0.0.0:22         0.0.0.0:*    users:(("sshd",pid=612,fd=3))',
    'tcp   LISTEN 0      128             [::]:22            [::]:*    users:(("sshd",pid=612,fd=4))',
    'tcp   LISTEN 0      511          0.0.0.0:80         0.0.0.0:*    users:(("nginx",pid=801,fd=6))',
    'tcp   LISTEN 0      4096       127.0.0.1:5432       0.0.0.0:*',
    'udp   UNCONN 0      0       127.0.0.53%lo:53         0.0.0.0:*    users:(("systemd-resolve",pid=44,fd=13))',
    'garbage line',
  ].join('\n');
  const ports = parsePorts(ss);
  it('reads port, protocol, address and the owning program', () => {
    expect(ports.find((p) => p.port === 80)).toEqual({
      proto: 'tcp',
      address: '0.0.0.0',
      port: 80,
      process: 'nginx',
      pid: 801,
    });
    expect(ports.find((p) => p.port === 53)).toMatchObject({
      proto: 'udp',
      address: '127.0.0.53',
      process: 'systemd-resolve',
    });
  });
  it('shows a service on IPv4 and IPv6 once, and keeps ports without process info', () => {
    expect(ports.filter((p) => p.port === 22)).toHaveLength(1);
    expect(ports.find((p) => p.port === 5432)).toEqual({
      proto: 'tcp',
      address: '127.0.0.1',
      port: 5432,
    });
  });
  it('is sorted by port and ignores junk', () => {
    expect(ports.map((p) => p.port)).toEqual([22, 53, 80, 5432]);
    expect(parsePorts('')).toEqual([]);
    expect(parsePorts('NO_SS')).toEqual([]);
  });
});

describe('parseSites', () => {
  const out = [
    '==FILE:default',
    'server { listen 80 default_server; server_name _; root /var/www/html; }',
    '==ENABLED:yes',
    '==FILE:example.com',
    '# Managed by GFV. Edit with care: GFV can recreate this file.',
    'server {',
    '  listen 80;',
    '  server_name example.com www.example.com;',
    '  location / { proxy_pass http://127.0.0.1:3000; }',
    '}',
    '==ENABLED:no',
    '==FILE:secure.com',
    'server { listen 443 ssl; server_name secure.com; root /srv/secure; }',
    '==ENABLED:yes',
  ].join('\n');
  const sites = parseSites(out);
  it('finds names, targets, enabled state and who manages the file', () => {
    expect(sites.map((s) => s.name)).toEqual(['default', 'example.com', 'secure.com']);
    const ex = sites[1]!;
    expect(ex).toMatchObject({
      enabled: false,
      serverNames: ['example.com', 'www.example.com'],
      target: 'http://127.0.0.1:3000',
      https: false,
      managedByGfv: true,
    });
    expect(sites[0]).toMatchObject({ enabled: true, target: '/var/www/html', managedByGfv: false });
  });
  it('detects HTTPS from a 443 listener', () => {
    expect(sites[2]!.https).toBe(true);
  });
  it('is empty for no output', () => {
    expect(parseSites('NO_NGINX')).toEqual([]);
  });
});

describe('the nginx actions', () => {
  const ctx = { sudo: 'sudo -n ' };
  const cmds = (id: string, params: unknown, c = ctx) => {
    const p = previewAction(id, params, c);
    if (!p.ok) throw new Error(JSON.stringify(p));
    return p.preview.commands;
  };
  it('create: write, link, test with automatic rollback, reload, and a backup first', () => {
    const c = cmds('nginx.site.create', { kind: 'proxy', domain: 'example.com', port: 3000 });
    const text = c.join('\n');
    expect(text).toContain('tee /etc/nginx/sites-available/example.com');
    expect(text).toContain(
      'ln -sf /etc/nginx/sites-available/example.com /etc/nginx/sites-enabled/example.com',
    );
    expect(text).toContain('nginx -t || { sudo -n rm -f /etc/nginx/sites-enabled/example.com;');
    expect(c.at(-1)).toBe('sudo -n systemctl reload nginx');
    expect(text).toContain('.gfv/snapshots'); // the snapshot step comes first
  });
  it('create on Fedora uses conf.d and no link', () => {
    const text = cmds(
      'nginx.site.create',
      { kind: 'static', domain: 'a.com', root: '/var/www/a' },
      { ...ctx, pkg: 'dnf' } as never,
    ).join('\n');
    expect(text).toContain('/etc/nginx/conf.d/a.com.conf');
    expect(text).not.toContain('sites-enabled');
  });
  it('refuses an injected domain before building any command', () => {
    expect(
      previewAction(
        'nginx.site.create',
        { kind: 'proxy', domain: 'a.com; rm -rf /', port: 80 },
        ctx,
      ).ok,
    ).toBe(false);
  });
  it('remove, https and the quiet list actions', () => {
    expect(cmds('nginx.site.remove', { domain: 'a.com' }).join('\n')).toContain(
      'rm -f /etc/nginx/sites-enabled/a.com',
    );
    const https = cmds('domains.https', { domain: 'a.com', email: 'me@a.com' }).join('\n');
    expect(https).toContain(
      'certbot --nginx -d a.com --non-interactive --agree-tos -m me@a.com --redirect',
    );
    expect(
      previewAction('domains.https', { domain: 'a.com', email: 'x; rm -rf /@a.com' }, ctx).ok,
    ).toBe(false);
    for (const id of ['ports.list', 'nginx.sites.list'])
      expect(previewAction(id, {}, ctx).ok).toBe(true);
  });
  it('https and certbot need confirmation (caution); the lists are quiet and safe', () => {
    const risk = (id: string, p: unknown) =>
      (previewAction(id, p, ctx) as { ok: true; preview: { risk: string } }).preview.risk;
    expect(risk('domains.https', { domain: 'a.com', email: 'me@a.com' })).toBe('caution');
    expect(risk('nginx.site.create', { kind: 'proxy', domain: 'a.com', port: 80 })).toBe('caution');
    expect(risk('ports.list', {})).toBe('safe');
  });
});
