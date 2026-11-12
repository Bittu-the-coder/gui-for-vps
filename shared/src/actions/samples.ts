import { z } from 'zod';
import { shellQuote } from '../shell.js';
import { defineAction } from './define.js';

/** Sample actions that prove the runner end to end. Real catalogs arrive with M5-M7. */

export const connectionTest = defineAction({
  id: 'connection.test',
  title: 'Test connection',
  explain: 'Prints the word "ok" on the server. If you see it, GFV can run commands there.',
  params: z.object({}),
  commands: () => ['echo ok'],
  risk: 'safe',
  recordable: false,
  internal: true,
});

export const systemUptime = defineAction({
  id: 'system.uptime',
  title: 'Show uptime and load',
  explain:
    'Shows how long the server has been running, how many users are logged in, and the load average (how busy the CPU has been over the last 1, 5 and 15 minutes).',
  params: z.object({}),
  commands: () => ['uptime'],
  risk: 'safe',
  recordable: false,
});

export const clearAptCache = defineAction({
  id: 'system.clear-apt-cache',
  title: 'Clear the package download cache',
  explain:
    'Deletes the .deb files apt downloaded earlier, which frees disk space. Installed programs are not touched; apt simply downloads again next time it needs a file.',
  params: z.object({}),
  commands: (_p, ctx) => [`${ctx.sudo}apt-get clean`, 'df -h /'],
  risk: 'caution',
  riskReason: 'Runs with sudo (administrator rights) and deletes files under /var/cache/apt.',
  recordable: true,
});

export const deletePath = defineAction({
  id: 'files.delete-path',
  title: 'Delete a file or folder',
  explain:
    'Removes the path you give, including everything inside it if it is a folder. There is no recycle bin on a server: deleted files are gone.',
  params: z.object({
    path: z.string().min(2).max(4096).regex(/^\//, 'must be an absolute path starting with /'),
  }),
  commands: ({ path }) => [`rm -rf -- ${shellQuote(path)}`],
  risk: 'danger',
  riskReason: 'Deleting is permanent and recursive. A wrong path can destroy data.',
  recordable: true,
  fields: [{ name: 'path', label: 'Path to delete', placeholder: '/tmp/old-stuff' }],
});
