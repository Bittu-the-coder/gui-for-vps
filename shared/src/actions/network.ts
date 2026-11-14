import { z } from 'zod';
import { domainSchema, renderSite, sitePaths, siteSchema } from '../nginx/site.js';
import { shellQuote } from '../shell.js';
import { defineAction } from './define.js';

/** `ss` shows which program owns each port only to root (or for your own processes): hence sudo. */
export const LIST_PORTS_COMMAND = (sudo: string) =>
  `${sudo}ss -H -lntup 2>/dev/null || echo "NO_SS"`;

export const listPorts = defineAction({
  id: 'ports.list',
  title: 'List listening ports',
  explain:
    'ss (socket statistics) lists every port a program is waiting on. -l listening, -n numbers not names, -t TCP, -u UDP, -p which program owns it (needs sudo to see other users’ programs).',
  params: z.object({}),
  commands: (_p, ctx) => [LIST_PORTS_COMMAND(ctx.sudo)],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

/** Prints every site file with its enabled state, for the list view (read-only). */
export const LIST_SITES_COMMAND = (sudo: string) =>
  'if ! command -v nginx >/dev/null 2>&1; then echo "NO_NGINX"; exit 0; fi; ' +
  'for f in /etc/nginx/sites-available/* /etc/nginx/conf.d/*.conf; do [ -f "$f" ] || continue; ' +
  'echo "==FILE:$(basename "$f")"; ' +
  `${sudo}cat "$f"; echo; ` +
  'b=$(basename "$f"); if [ -e "/etc/nginx/sites-enabled/$b" ] || [ "$(dirname "$f")" = /etc/nginx/conf.d ]; ' +
  'then echo "==ENABLED:yes"; else echo "==ENABLED:no"; fi; done';

export const listSites = defineAction({
  id: 'nginx.sites.list',
  title: 'List nginx sites',
  explain:
    'Reads each nginx site file (sites-available, or conf.d on Fedora/RHEL) and checks whether it is enabled (linked from sites-enabled).',
  params: z.object({}),
  commands: (_p, ctx) => [LIST_SITES_COMMAND(ctx.sudo)],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

const reload = (ctx: { sudo: string }) => `${ctx.sudo}systemctl reload nginx`;

export const createSite = defineAction({
  id: 'nginx.site.create',
  title: 'Add an nginx site',
  explain:
    'Writes a site file for your domain (a reverse proxy to a local port, or a static folder), enables it, checks the whole nginx configuration with `nginx -t`, and reloads nginx. If the check fails, the new site is removed again so nginx keeps running as before.',
  params: siteSchema,
  snapshotPaths: (p) => [sitePaths(p.domain, 'apt').file],
  commands: (p, ctx) => {
    const { file, link } = sitePaths(p.domain, ctx.pkg === 'dnf' ? 'dnf' : 'apt');
    const text = renderSite(p);
    const write = `printf '%s' ${shellQuote(text)} | ${ctx.sudo}tee ${shellQuote(file)} >/dev/null`;
    const undo = link
      ? `${ctx.sudo}rm -f ${shellQuote(link)}`
      : `${ctx.sudo}rm -f ${shellQuote(file)}`;
    return [
      write,
      ...(link ? [`${ctx.sudo}ln -sf ${shellQuote(file)} ${shellQuote(link)}`] : []),
      `${ctx.sudo}nginx -t || { ${undo}; echo "nginx rejected this configuration, so the site was not enabled." >&2; exit 1; }`,
      reload(ctx),
    ];
  },
  risk: 'caution',
  riskReason:
    'Changes the web server configuration with administrator rights and reloads nginx. A mistake can take your sites offline (GFV checks the configuration first and backs up an existing file).',
  recordable: false,
  internal: true,
});

export const removeSite = defineAction({
  id: 'nginx.site.remove',
  title: 'Remove an nginx site',
  explain:
    'Disables the site (removes its link from sites-enabled), deletes its site file (a backup is saved first), checks the configuration, and reloads nginx.',
  params: z.object({ domain: domainSchema }),
  snapshotPaths: (p) => [sitePaths(p.domain, 'apt').file],
  commands: ({ domain }, ctx) => {
    const { file, link } = sitePaths(domain, ctx.pkg === 'dnf' ? 'dnf' : 'apt');
    return [
      ...(link ? [`${ctx.sudo}rm -f ${shellQuote(link)}`] : []),
      `${ctx.sudo}rm -f ${shellQuote(file)}`,
      `${ctx.sudo}nginx -t`,
      reload(ctx),
    ];
  },
  risk: 'caution',
  riskReason:
    'Takes this site offline. Its configuration file is backed up first, so you can restore it.',
  recordable: false,
  internal: true,
});

export const installCertbot = defineAction({
  id: 'domains.install-certbot',
  title: 'Install certbot (Let’s Encrypt)',
  explain:
    'Installs certbot and its nginx plugin with the system package manager. certbot is the free tool that gets and renews HTTPS certificates from Let’s Encrypt.',
  params: z.object({}),
  commands: (_p, ctx) =>
    ctx.pkg === 'dnf'
      ? [`${ctx.sudo}dnf -y -q install certbot python3-certbot-nginx`, 'certbot --version']
      : [
          `${ctx.sudo}env DEBIAN_FRONTEND=noninteractive apt-get -y -q -o DPkg::Lock::Timeout=120 update`,
          `${ctx.sudo}env DEBIAN_FRONTEND=noninteractive apt-get -y -q -o DPkg::Lock::Timeout=120 install certbot python3-certbot-nginx`,
          'certbot --version',
        ],
  risk: 'caution',
  riskReason: 'Installs software with administrator rights.',
  recordable: false,
  longRunning: true,
  internal: true,
});

export const enableHttps = defineAction({
  id: 'domains.https',
  title: 'Get an HTTPS certificate',
  explain:
    'Asks Let’s Encrypt for a certificate for your domain with certbot, installs it into the nginx site, and redirects http to https. By running this you agree to Let’s Encrypt’s Terms of Service (--agree-tos). Your domain must already point at this server and ports 80 and 443 must be reachable from the internet.',
  params: z.object({
    domain: domainSchema,
    email: z
      .string()
      .max(254)
      .regex(
        /^[^\s@;'"`$\\<>|&()]+@[^\s@;'"`$\\<>|&()]+\.[^\s@;'"`$\\<>|&()]+$/,
        'an email address',
      ),
  }),
  commands: ({ domain, email }, ctx) => [
    'command -v certbot >/dev/null 2>&1 || { echo "certbot is not installed: install it first." >&2; exit 1; }',
    `${ctx.sudo}certbot --nginx -d ${shellQuote(domain)} --non-interactive --agree-tos -m ${shellQuote(email)} --redirect`,
  ],
  risk: 'caution',
  riskReason:
    'Contacts Let’s Encrypt, accepts its Terms of Service on your behalf, and changes the nginx site. If the domain does not point here yet, the request fails.',
  recordable: false,
  longRunning: true,
  internal: true,
});

export const networkActions = [
  listPorts,
  listSites,
  createSite,
  removeSite,
  installCertbot,
  enableHttps,
];
