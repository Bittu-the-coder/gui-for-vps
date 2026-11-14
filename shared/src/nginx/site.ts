import { z } from 'zod';

/**
 * nginx site files and the listening-ports table, as pure functions.
 *
 * Everything that ends up INSIDE a generated config is validated with a strict pattern first (a domain is letters,
 * digits, dots and hyphens; a port is a number; a folder is a plain absolute path). A value that could carry nginx
 * syntax (a `;`, a brace, a newline, a quote, a space) is refused, so a site can never smuggle in directives.
 */

export const domainSchema = z
  .string()
  .max(253)
  .regex(
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/,
    'a domain like example.com (lower-case letters, digits, dots and hyphens)',
  );

const plainPath = z
  .string()
  .max(1024)
  .regex(/^\/[A-Za-z0-9_.\-/]*$/, 'an absolute folder path (letters, digits and _ . - /)')
  .refine((p) => !p.split('/').includes('..'), 'no ".." in the path');

export const siteSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('proxy'),
    domain: domainSchema,
    /** The local port your app listens on (for example 3000). */
    port: z.number().int().min(1).max(65535),
  }),
  z.object({ kind: z.literal('static'), domain: domainSchema, root: plainPath }),
]);
export type SiteSpec = z.infer<typeof siteSchema>;

/** Where a site's config lives: Debian/Ubuntu use sites-available + a symlink, Fedora/RHEL use conf.d. */
export function sitePaths(domain: string, pkg: 'apt' | 'dnf' | undefined) {
  if (pkg === 'dnf') {
    const file = `/etc/nginx/conf.d/${domain}.conf`;
    return { file, link: null as string | null };
  }
  return {
    file: `/etc/nginx/sites-available/${domain}`,
    link: `/etc/nginx/sites-enabled/${domain}`,
  };
}

/** The nginx config text for a site (the spec must already be validated). */
export function renderSite(spec: SiteSpec): string {
  const head = [
    '# Managed by GFV. Edit with care: GFV can recreate this file.',
    'server {',
    '    listen 80;',
    '    listen [::]:80;',
    `    server_name ${spec.domain};`,
    '',
  ];
  const body =
    spec.kind === 'proxy'
      ? [
          '    location / {',
          `        proxy_pass http://127.0.0.1:${spec.port};`,
          '        proxy_http_version 1.1;',
          '        proxy_set_header Host $host;',
          '        proxy_set_header X-Real-IP $remote_addr;',
          '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
          '        proxy_set_header X-Forwarded-Proto $scheme;',
          '        proxy_set_header Upgrade $http_upgrade;',
          '        proxy_set_header Connection "upgrade";',
          '    }',
        ]
      : [
          `    root ${spec.root};`,
          '    index index.html;',
          '',
          '    location / {',
          '        try_files $uri $uri/ =404;',
          '    }',
        ];
  return [...head, ...body, '}', ''].join('\n');
}

// --- Parsers ---------------------------------------------------------------------------------------

export interface ListeningPort {
  proto: 'tcp' | 'udp';
  address: string;
  port: number;
  process?: string;
  pid?: number;
}

/**
 * `ss -H -lntup` output. Lines look like:
 *   tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=612,fd=3))
 *   udp UNCONN 0 0 127.0.0.53%lo:53 0.0.0.0:*
 * Process info is only there when GFV may see it (root, or the user's own processes).
 */
export function parsePorts(text: string): ListeningPort[] {
  const out: ListeningPort[] = [];
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    if ((f[0] !== 'tcp' && f[0] !== 'udp') || f.length < 5) continue;
    const local = f[4]!;
    const at = local.lastIndexOf(':');
    const port = Number(local.slice(at + 1));
    if (at < 0 || !Number.isInteger(port)) continue;
    const proc = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
    out.push({
      proto: f[0],
      address: local
        .slice(0, at)
        .replace(/^\[|\]$/g, '')
        .replace(/%.*$/, ''),
      port,
      ...(proc ? { process: proc[1]!, pid: Number(proc[2]) } : {}),
    });
  }
  // The same socket can be reported twice (the plain view and the sudo view): keep the entry that names the program.
  const bySocket = new Map<string, ListeningPort>();
  for (const p of out) {
    const k = `${p.proto}:${p.address}:${p.port}`;
    const have = bySocket.get(k);
    if (!have || (!have.process && p.process)) bySocket.set(k, p);
  }
  out.length = 0;
  out.push(...bySocket.values());
  // The same service often listens on IPv4 and IPv6: show each (proto, port, process) once, most specific first.
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto))
    .filter((p) => {
      const k = `${p.proto}:${p.port}:${p.process ?? ''}:${p.address === '::' || p.address === '0.0.0.0' || p.address === '*' ? 'any' : p.address}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
}

export interface NginxSite {
  name: string;
  enabled: boolean;
  serverNames: string[];
  /** What it serves: a proxy target or a static folder. */
  target?: string;
  https: boolean;
  managedByGfv: boolean;
}

/** Output of the list command: `==NAME` / `==ENABLED:yes|no` markers around each file's contents. */
export function parseSites(text: string): NginxSite[] {
  const sites: NginxSite[] = [];
  let cur: { name: string; enabled: boolean; body: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const body = cur.body.join('\n');
    const names = [...body.matchAll(/\bserver_name\s+([^;]+);/g)].flatMap((m) =>
      m[1]!.trim().split(/\s+/),
    );
    const proxy = /\bproxy_pass\s+([^;]+);/.exec(body)?.[1]?.trim();
    const root = /\broot\s+([^;]+);/.exec(body)?.[1]?.trim();
    sites.push({
      name: cur.name,
      enabled: cur.enabled,
      serverNames: [...new Set(names)],
      ...(proxy ? { target: proxy } : root ? { target: root } : {}),
      https: /\blisten\s+[^;]*443/.test(body),
      managedByGfv: body.startsWith('# Managed by GFV'),
    });
    cur = null;
  };
  for (const line of text.split('\n')) {
    const m = /^==FILE:(.+)$/.exec(line);
    if (m) {
      flush();
      cur = { name: m[1]!, enabled: false, body: [] };
    } else if (cur && /^==ENABLED:(yes|no)$/.test(line)) cur.enabled = line.endsWith('yes');
    else if (cur) cur.body.push(line);
  }
  flush();
  return sites;
}
