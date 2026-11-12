import { z } from 'zod';
import { DETECT_COMMAND } from '../devhub/detect.js';
import { purgePostgresCommands, TOOLS } from '../devhub/tools.js';
import { defineAction } from './define.js';

export const devhubDetect = defineAction({
  id: 'devhub.detect',
  title: 'Check installed tools',
  explain:
    'Asks each tool for its version (git --version, node -v ...) and systemd whether its service is running. A tool that is not installed just prints nothing.',
  params: z.object({}),
  commands: () => [DETECT_COMMAND],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

const none = z.object({});

const installs = TOOLS.map((t) =>
  defineAction({
    id: `devhub.install.${t.id}`,
    title: `Install ${t.name}`,
    explain: t.installExplain,
    params: none,
    commands: (_p, ctx) => t.install(ctx),
    risk: 'caution',
    riskReason: `Installs software on the server${t.id === 'node' ? '' : ' with administrator rights'}. It downloads packages, so it can take a few minutes.`,
    recordable: true,
    longRunning: true,
    internal: true,
  }),
);

const uninstalls = TOOLS.map((t) =>
  defineAction({
    id: `devhub.uninstall.${t.id}`,
    title: `Uninstall ${t.name}`,
    explain: t.uninstallExplain,
    params: none,
    commands: (_p, ctx) => t.uninstall(ctx),
    risk: 'caution',
    riskReason: 'Removes software. Programs on this server that use it will stop working.',
    recordable: true,
    longRunning: true,
    internal: true,
  }),
);

export const purgePostgres = defineAction({
  id: 'devhub.purge.postgresql',
  title: 'Uninstall PostgreSQL and delete all databases',
  explain:
    'Purges the PostgreSQL packages and then deletes /var/lib/postgresql (where every database lives) and /etc/postgresql (the configuration).',
  params: none,
  commands: (_p, ctx) => purgePostgresCommands(ctx),
  risk: 'danger',
  riskReason: 'Every database on this server is permanently deleted. There is no undo.',
  recordable: true,
  longRunning: true,
  internal: true,
});

export const devhubActions = [devhubDetect, ...installs, ...uninstalls, purgePostgres];
