import { z } from 'zod';

/**
 * The App Store catalog: a short, curated list of well-known Docker images. Nothing here comes from the network:
 * an entry is code, reviewed with the rest of GFV. Every image is pinned to a tag (never `latest`), runs as ONE
 * container named `gfv-<id>` with a restart policy, one named data volume and (when it needs them) passwords that
 * are generated ON THE SERVER into a private env file, so a secret never appears in a command line or in history.
 */
export interface AppDef {
  id: string;
  name: string;
  tagline: string;
  /** What it is for, in plain words (shown before installing). */
  description: string;
  image: string;
  /** The port inside the container, and whether it speaks HTTP (a link and a domain make sense) or not. */
  port: number;
  web: boolean;
  /** Default port on the server (the host side). */
  defaultHostPort: number;
  /** Where the data lives inside the container: mounted from a named volume so upgrades keep it. */
  dataPath: string;
  /** Environment variables set to a freshly generated random password. */
  secrets: string[];
  /** Fixed environment variables (no secrets). */
  env?: Record<string, string>;
  /** Overrides the image's command. `$VAR` is expanded INSIDE the container (never on the host command line). */
  shellCommand?: string;
  /** A hint shown after installing. */
  after: string;
}

export const APPS: AppDef[] = [
  {
    id: 'whoami',
    name: 'whoami',
    tagline: 'A tiny test web page',
    description:
      'Shows the container’s name and the request it received. The quickest way to check that a port, a firewall rule or a domain really reaches your server.',
    image: 'traefik/whoami:v1.10.3',
    port: 80,
    web: true,
    defaultHostPort: 8081,
    dataPath: '/tmp/whoami-unused',
    secrets: [],
    after: 'Open it in a browser: you should see a page that prints the container’s hostname.',
  },
  {
    id: 'uptime-kuma',
    name: 'Uptime Kuma',
    tagline: 'Watch your websites and get alerts',
    description:
      'A friendly monitor that checks your sites and services every minute and tells you (email, Telegram, Discord…) when one goes down. You create the admin account on first visit.',
    image: 'louislam/uptime-kuma:1',
    port: 3001,
    web: true,
    defaultHostPort: 3001,
    dataPath: '/app/data',
    secrets: [],
    after:
      'Open it and create the admin account straight away: the first visitor becomes the admin.',
  },
  {
    id: 'grafana',
    name: 'Grafana',
    tagline: 'Dashboards for your numbers',
    description:
      'Charts and dashboards for metrics and logs. The admin password is generated for you (see “Show credentials”).',
    image: 'grafana/grafana-oss:11.3.0',
    port: 3000,
    web: true,
    defaultHostPort: 3000,
    dataPath: '/var/lib/grafana',
    secrets: ['GF_SECURITY_ADMIN_PASSWORD'],
    env: { GF_SECURITY_ADMIN_USER: 'admin' },
    after: 'Log in as admin with the generated password (Show credentials).',
  },
  {
    id: 'vaultwarden',
    name: 'Vaultwarden',
    tagline: 'Your own password manager',
    description:
      'A light, Bitwarden-compatible password server. Browsers refuse to use it without HTTPS, so put a domain with HTTPS in front of it (Network app) before you rely on it.',
    image: 'vaultwarden/server:1.32.7',
    port: 80,
    web: true,
    defaultHostPort: 8082,
    dataPath: '/data',
    secrets: [],
    env: { SIGNUPS_ALLOWED: 'true' },
    after:
      'Create your account, then set SIGNUPS_ALLOWED to false by reinstalling without signups once everyone is in.',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    tagline: 'A database in a container',
    description:
      'A PostgreSQL 16 database server in its own container (separate from any PostgreSQL installed on the server). The "postgres" password is generated for you.',
    image: 'postgres:16-alpine',
    port: 5432,
    web: false,
    defaultHostPort: 5433,
    dataPath: '/var/lib/postgresql/data',
    secrets: ['POSTGRES_PASSWORD'],
    after:
      'Connect to it from the server on the port you chose, user "postgres", password from Show credentials.',
  },
  {
    id: 'redis',
    name: 'Redis',
    tagline: 'A fast key-value store and cache',
    description:
      'Redis 7 with a required password (generated for you). Great as a cache or a job queue for your apps.',
    image: 'redis:7-alpine',
    port: 6379,
    web: false,
    defaultHostPort: 6380,
    dataPath: '/data',
    secrets: ['REDIS_PASSWORD'],
    shellCommand: 'exec redis-server --appendonly yes --requirepass "$REDIS_PASSWORD"',
    after: 'Connect on the port you chose with the password from Show credentials.',
  },
];

export const appById = (id: string): AppDef | undefined => APPS.find((a) => a.id === id);

export const APP_IDS = APPS.map((a) => a.id) as [string, ...string[]];

export const containerName = (id: string) => `gfv-${id}`;
export const volumeName = (id: string) => `gfv-${id}-data`;
export const envFile = (id: string) => `$HOME/.gfv/apps/${id}.env`;

export const installSchema = z.object({
  app: z.enum(APP_IDS),
  /** The port on the SERVER that reaches the app. */
  hostPort: z.number().int().min(1024).max(65535),
  /** false: only the server itself can reach it (127.0.0.1); true: the whole internet can, unless a firewall says no. */
  expose: z.boolean(),
});
export type InstallParams = z.infer<typeof installSchema>;

// ---- reading the list back ------------------------------------------------------------------------------------------

export interface InstalledApp {
  id: string;
  container: string;
  image: string;
  state: 'running' | 'stopped' | 'other';
  status: string;
  /** The host side of the published port, and whether it listens on every address. */
  hostPort?: number;
  exposed: boolean;
}

export const LIST_APPS_COMMAND = (sudo: string) =>
  `command -v docker >/dev/null 2>&1 || { echo NO_DOCKER; exit 0; }; ${sudo}docker info >/dev/null 2>&1 || { echo DOCKER_DOWN; exit 0; }; ` +
  `${sudo}docker ps -a --filter label=gfv.app --format '{{.Label "gfv.app"}}|{{.Names}}|{{.State}}|{{.Status}}|{{.Image}}|{{.Ports}}'`;

export type AppsListing =
  { kind: 'no_docker' } | { kind: 'docker_down' } | { kind: 'ok'; apps: InstalledApp[] };

export function parseInstalled(text: string): AppsListing {
  if (/NO_DOCKER/.test(text)) return { kind: 'no_docker' };
  if (/DOCKER_DOWN/.test(text)) return { kind: 'docker_down' };
  const apps: InstalledApp[] = [];
  for (const line of text.split('\n')) {
    const [id, container, state, status, image, ports = ''] = line.split('|');
    if (!id || !container || !APP_IDS.includes(id)) continue;
    const m = /(0\.0\.0\.0|127\.0\.0\.1|\[::\]|::):(\d+)->/.exec(ports);
    apps.push({
      id,
      container,
      image: image ?? '',
      state:
        state === 'running'
          ? 'running'
          : state === 'exited' || state === 'created'
            ? 'stopped'
            : 'other',
      status: status ?? '',
      ...(m ? { hostPort: Number(m[2]) } : {}),
      exposed: !!m && m[1] !== '127.0.0.1',
    });
  }
  return { kind: 'ok', apps };
}

/** `KEY=value` lines of an env file, for "Show credentials". Only the generated secrets are returned. */
export function parseCredentials(text: string, app: AppDef): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const line of text.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && app.secrets.includes(m[1]!)) out.push({ name: m[1]!, value: m[2]! });
  }
  return out;
}
