import { z } from 'zod';
import {
  appById,
  containerName,
  envFile,
  installSchema,
  LIST_APPS_COMMAND,
  volumeName,
  APP_IDS,
} from '../appstore/catalog.js';
import { shellQuote } from '../shell.js';
import { defineAction } from './define.js';

const NEEDS_DOCKER =
  'command -v docker >/dev/null 2>&1 || { echo "Docker is not installed: install it from the Dev Hub first." >&2; exit 1; }';
const idOnly = z.object({ app: z.enum(APP_IDS) });

export const listApps = defineAction({
  id: 'apps.list',
  title: 'List installed apps',
  explain:
    'docker ps --filter label=gfv.app lists the containers GFV installed (it labels each one), with their state and published port.',
  params: z.object({}),
  commands: (_p, ctx) => [LIST_APPS_COMMAND(ctx.sudo)],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

export const appCredentials = defineAction({
  id: 'apps.credentials',
  title: 'Show an app’s generated passwords',
  explain:
    'Reads the private env file (~/.gfv/apps/<app>.env, readable only by you) where the install stored the passwords it generated.',
  params: idOnly,
  commands: (p) => [`cat ${envFile(p.app)} 2>/dev/null || true`],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

export const installApp = defineAction({
  id: 'apps.install',
  title: 'Install an app',
  explain:
    'Generates any passwords on the server into a private env file, downloads the pinned image (docker pull) and starts it as one container (docker run -d) with a restart policy and its own data volume, so updates and restarts keep your data.',
  params: installSchema,
  commands: (p, ctx) => {
    const app = appById(p.app)!;
    const name = containerName(app.id);
    const env = envFile(app.id);
    const gen = (k: string) =>
      `echo "${k}=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"`;
    const bind = p.expose ? '0.0.0.0' : '127.0.0.1';
    const run = [
      `${ctx.sudo}docker run -d --name ${name} --restart unless-stopped`,
      `--label gfv.app=${app.id}`,
      `--env-file "${env}"`,
      ...Object.entries(app.env ?? {}).map(([k, v]) => `-e ${shellQuote(`${k}=${v}`)}`),
      `-p ${bind}:${p.hostPort}:${app.port}`,
      `-v ${volumeName(app.id)}:${app.dataPath}`,
      app.image,
      ...(app.shellCommand ? [`sh -c ${shellQuote(app.shellCommand)}`] : []),
    ].join(' ');
    return [
      NEEDS_DOCKER,
      `${ctx.sudo}docker info >/dev/null 2>&1 || { echo "The Docker service is not running: start it in the Services app (docker.service)." >&2; exit 1; }`,
      `if ${ctx.sudo}docker inspect ${name} >/dev/null 2>&1; then echo "${app.name} is already installed (container ${name}). Remove it first to install again." >&2; exit 1; fi`,
      // Passwords are made here, on the server, and only ever written to a file only the SSH user can read.
      `mkdir -p -m 700 "$HOME/.gfv" "$HOME/.gfv/apps" && [ -e "${env}" ] || { umask 077; { ${[...app.secrets.map(gen), ':'].join('; ')}; } > "${env}"; }`,
      `${ctx.sudo}docker pull ${app.image}`,
      run,
    ];
  },
  risk: 'caution',
  riskReason:
    'Downloads and runs third-party software with administrator rights on Docker, and uses disk space. “Reachable from the internet” opens the port to everyone unless a firewall blocks it.',
  longRunning: true,
  recordable: false,
  internal: true,
});

export const removeApp = defineAction({
  id: 'apps.remove',
  title: 'Remove an app',
  explain:
    'Stops and deletes the container. With "delete data" it also deletes the data volume and the generated passwords; without it, installing the app again finds your data where you left it.',
  params: idOnly.extend({ deleteData: z.boolean() }),
  commands: (p, ctx) => [
    `${ctx.sudo}docker rm -f ${containerName(p.app)}`,
    ...(p.deleteData
      ? [`${ctx.sudo}docker volume rm ${volumeName(p.app)}`, `rm -f ${envFile(p.app)}`]
      : []),
  ],
  dynamicRisk: (p) =>
    p.deleteData
      ? {
          risk: 'danger',
          reason:
            'Deleting the data volume erases everything this app stored. This cannot be undone.',
        }
      : undefined,
  risk: 'caution',
  riskReason: 'The app stops being available.',
  recordable: false,
  internal: true,
});

export const appStoreActions = [listApps, appCredentials, installApp, removeApp];
