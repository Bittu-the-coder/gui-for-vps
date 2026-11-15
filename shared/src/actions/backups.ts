import { z } from 'zod';
import {
  ARCHIVE,
  backupName,
  backupSchema,
  LIST_BACKUPS_COMMAND,
  renderScript,
  renderService,
  renderTimer,
  backupUnit,
  unitPaths,
} from '../backups/schedule.js';
import { shellQuote } from '../shell.js';
import { defineAction, type ActionCtx } from './define.js';

const tee = (ctx: ActionCtx, text: string, file: string) =>
  `printf '%s' ${shellQuote(text)} | ${ctx.sudo}tee ${shellQuote(file)} >/dev/null`;

const home = (ctx: ActionCtx) => ctx.home ?? '$HOME';

export const listBackups = defineAction({
  id: 'backup.list',
  title: 'List scheduled backups',
  explain:
    'Reads the backup timers GFV created (systemd units named gfv-backup-<name>), when each runs next, and the archives in ~/.gfv/backups.',
  params: z.object({}),
  commands: () => [LIST_BACKUPS_COMMAND],
  risk: 'safe',
  recordable: false,
  quiet: true,
  internal: true,
});

export const scheduleBackup = defineAction({
  id: 'backup.schedule',
  title: 'Schedule a backup',
  explain:
    'Writes a small script and a systemd timer. At the chosen time the server packs the folders into a .tar.gz in ~/.gfv/backups/<name>/ and deletes the oldest archives beyond the number you keep. A timer is systemd’s version of cron; "Persistent" means a missed run happens when the server is next on, so if the chosen hour has already passed today the first backup may run right away.',
  params: backupSchema,
  snapshotPaths: (p) => Object.values(unitPaths(p.name)),
  commands: (p, ctx) => {
    const u = unitPaths(p.name);
    const user = ctx.user ?? 'root';
    return [
      `${ctx.sudo}mkdir -p /usr/local/lib/gfv`,
      tee(ctx, renderScript(p, home(ctx), user), u.script),
      `${ctx.sudo}chmod 755 ${shellQuote(u.script)}`,
      tee(ctx, renderService(p), u.service),
      tee(ctx, renderTimer(p), u.timer),
      `${ctx.sudo}systemctl daemon-reload`,
      `${ctx.sudo}systemctl enable --now ${backupUnit(p.name)}.timer`,
    ];
  },
  risk: 'caution',
  riskReason:
    'Creates a script that runs as root every day or week and reads the folders you chose. Archives are stored in your home folder on the server: copy them elsewhere too, a backup on the same disk does not survive the disk.',
  recordable: false,
  internal: true,
});

export const runBackupNow = defineAction({
  id: 'backup.run-now',
  title: 'Back up now',
  explain:
    'Starts the backup service once, right now (the same thing the timer does), and waits for it to finish.',
  params: backupName,
  commands: (p, ctx) => [
    `${ctx.sudo}systemctl start ${backupUnit(p.name)}.service`,
    `ls -1t "$HOME/.gfv/backups/${p.name}" | head -1`,
  ],
  risk: 'caution',
  riskReason:
    'Reads the chosen folders as root and writes an archive to disk (it can take a while for big folders).',
  longRunning: true,
  recordable: false,
  internal: true,
});

export const removeBackup = defineAction({
  id: 'backup.remove',
  title: 'Remove a backup schedule',
  explain:
    'Stops and deletes the timer, the service and the script. The archives already made stay in ~/.gfv/backups, so nothing you saved is lost.',
  params: backupName,
  commands: (p, ctx) => {
    const u = unitPaths(p.name);
    return [
      `${ctx.sudo}systemctl disable --now ${backupUnit(p.name)}.timer`,
      `${ctx.sudo}rm -f ${shellQuote(u.timer)} ${shellQuote(u.service)} ${shellQuote(u.script)}`,
      `${ctx.sudo}systemctl daemon-reload`,
    ];
  },
  risk: 'caution',
  riskReason: 'The backup will no longer run. Existing archives are kept.',
  recordable: false,
  internal: true,
});

export const restoreBackup = defineAction({
  id: 'backup.restore',
  title: 'Restore a backup into a folder',
  explain:
    'Unpacks the archive into a NEW folder, ~/gfv-restore/<name>-<date>. Your live files are not touched: look at what is inside, then copy what you need back yourself.',
  params: z.object({ name: backupName.shape.name, archive: z.string().regex(ARCHIVE) }),
  commands: (p) => {
    const dir = `"$HOME/gfv-restore/${p.name}-${p.archive.replace('.tar.gz', '')}"`;
    return [
      `[ -f "$HOME/.gfv/backups/${p.name}/${p.archive}" ] || { echo "That archive does not exist." >&2; exit 1; }`,
      `mkdir -p ${dir} && tar -xzf "$HOME/.gfv/backups/${p.name}/${p.archive}" -C ${dir} && echo "Restored into ${'$'}HOME/gfv-restore/${p.name}-${p.archive.replace('.tar.gz', '')} (your live files were not touched)"`,
    ];
  },
  risk: 'caution',
  riskReason:
    'Writes the archive’s files into a new folder in your home directory (it needs disk space).',
  recordable: false,
  internal: true,
});

export const deleteArchive = defineAction({
  id: 'backup.delete-archive',
  title: 'Delete a backup archive',
  explain:
    'Deletes one archive file. Backups beyond the "keep" number are deleted automatically; this removes one earlier.',
  params: z.object({ name: backupName.shape.name, archive: z.string().regex(ARCHIVE) }),
  commands: (p) => [`rm -f -- "$HOME/.gfv/backups/${p.name}/${p.archive}"`],
  risk: 'caution',
  riskReason: 'The archive is gone for good.',
  recordable: false,
  internal: true,
});

export const backupActions = [
  listBackups,
  scheduleBackup,
  runBackupNow,
  removeBackup,
  restoreBackup,
  deleteArchive,
];
