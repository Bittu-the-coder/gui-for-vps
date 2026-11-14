import { z } from 'zod';
import { shellQuote } from '../shell.js';

/**
 * Scheduled backups: a real systemd timer on the server runs a small script as root that packs chosen folders into
 * ~/.gfv/backups/<name>/<stamp>.tar.gz (owned by the SSH user, so Files can download it) and keeps the newest N.
 * Everything that reaches a file or a command is validated here: names and paths cannot carry shell or unit syntax.
 */

const pathSchema = z
  .string()
  .regex(
    /^\/[A-Za-z0-9_.@+=,:/-]+$/,
    'Use a plain absolute path like /etc or /var/www (no spaces or special characters)',
  )
  .refine((p) => !p.split('/').includes('..'), 'A path cannot contain ".."')
  .refine((p) => p !== '/', 'Backing up the whole disk (/) is not supported: choose folders');

export const backupSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,30}$/, 'Use lowercase letters, digits and dashes (max 31)'),
  paths: z.array(pathSchema).min(1, 'Choose at least one folder').max(20),
  frequency: z.enum(['daily', 'weekly']),
  /** Hour of the day (server time), 0-23. */
  hour: z.number().int().min(0).max(23),
  /** How many archives to keep. */
  keep: z.number().int().min(1).max(60),
});
export type BackupSpec = z.infer<typeof backupSchema>;

export const backupName = z.object({ name: backupSchema.shape.name });
export const ARCHIVE = /^[0-9]{8}-[0-9]{6}\.tar\.gz$/;

export const scriptPath = (name: string) => `/usr/local/lib/gfv/backup-${name}.sh`;
export const backupUnit = (name: string) => `gfv-backup-${name}`;
export const unitPaths = (name: string) => ({
  script: scriptPath(name),
  service: `/etc/systemd/system/${backupUnit(name)}.service`,
  timer: `/etc/systemd/system/${backupUnit(name)}.timer`,
});

export const calendar = (s: Pick<BackupSpec, 'frequency' | 'hour'>) =>
  `${s.frequency === 'weekly' ? 'Mon ' : ''}*-*-* ${String(s.hour).padStart(2, '0')}:00:00`;

/** The root-owned script. `# gfv:` lines are read back by the list view. */
export function renderScript(s: BackupSpec, home: string, user: string): string {
  const dest = `${home}/.gfv/backups/${s.name}`;
  return [
    '#!/bin/sh',
    '# Managed by GFV (Backups). Remove it with the Backups app.',
    `# gfv:schedule=${s.frequency} ${s.hour}`,
    `# gfv:keep=${s.keep}`,
    `# gfv:paths=${s.paths.join(' ')}`,
    'set -eu',
    `DEST=${shellQuote(dest)}`,
    'mkdir -p "$DEST"',
    'FILE="$DEST/$(date +%Y%m%d-%H%M%S).tar.gz"',
    // Archive names are relative to / so a restore goes into any folder. Exit 1 only means "a file changed while
    // reading", which is normal for live data; anything else (a missing path: 2) fails the run.
    `tar -czf "$FILE.partial" -C / ${s.paths.map((p) => shellQuote(p.slice(1))).join(' ')} || [ $? -eq 1 ]`,
    'mv "$FILE.partial" "$FILE"',
    'chmod 600 "$FILE"',
    `chown -R ${shellQuote(user)}: ${shellQuote(`${home}/.gfv/backups`)}`,
    `ls -1t "$DEST"/*.tar.gz | tail -n +${s.keep + 1} | xargs -r rm -f --`,
    'echo "Backup written: $FILE"',
    '',
  ].join('\n');
}

export const renderService = (s: Pick<BackupSpec, 'name'>) =>
  [
    '[Unit]',
    `Description=GFV backup ${s.name}`,
    '',
    '[Service]',
    'Type=oneshot',
    `ExecStart=${scriptPath(s.name)}`,
    '',
  ].join('\n');

export const renderTimer = (s: BackupSpec) =>
  [
    '[Unit]',
    `Description=GFV backup ${s.name} (${s.frequency})`,
    '',
    '[Timer]',
    `OnCalendar=${calendar(s)}`,
    'Persistent=true',
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n');

// ---- reading the list back -----------------------------------------------------------------------------------------

export interface BackupArchive {
  name: string;
  sizeBytes: number;
  /** Seconds since 1970. */
  at: number;
}
export interface BackupJob {
  name: string;
  frequency: 'daily' | 'weekly';
  hour: number;
  keep: number;
  paths: string[];
  /** The timer is active (it will run). */
  active: boolean;
  /** When it runs next, seconds since 1970 (0 = unknown). */
  nextAt: number;
  /** Result of the last run ("success", "failed", ...), empty if it never ran. */
  last: string;
  archives: BackupArchive[];
}

export const LIST_BACKUPS_COMMAND =
  'echo "home=$HOME"; for t in /etc/systemd/system/gfv-backup-*.timer; do [ -e "$t" ] || continue; n=$(basename "$t" .timer); n=${n#gfv-backup-}; ' +
  's=/usr/local/lib/gfv/backup-$n.sh; echo "==BACKUP:$n"; grep -h "^# gfv:" "$s" 2>/dev/null | sed "s/^# gfv://"; ' +
  'echo "active=$(systemctl is-active gfv-backup-$n.timer 2>/dev/null)"; ' +
  'echo "next=$(systemctl show -p NextElapseUSecRealtime --value gfv-backup-$n.timer 2>/dev/null)"; ' +
  'echo "last=$(systemctl show -p Result --value gfv-backup-$n.service 2>/dev/null)"; ' +
  'for f in "$HOME/.gfv/backups/$n"/*.tar.gz; do [ -e "$f" ] || continue; echo "==FILE:$(basename "$f") $(stat -c "%s %Y" "$f")"; done; done; true';

/** The SSH user's home directory on the server (where archives live), from the first line of the listing. */
export const parseBackupHome = (text: string): string | undefined =>
  /^home=(\/\S*)$/m.exec(text)?.[1];

export function parseBackupJobs(text: string): BackupJob[] {
  const jobs: BackupJob[] = [];
  let cur: BackupJob | null = null;
  for (const line of text.split('\n')) {
    const name = /^==BACKUP:([a-z0-9-]+)$/.exec(line)?.[1];
    if (name) {
      cur = {
        name,
        frequency: 'daily',
        hour: 0,
        keep: 0,
        paths: [],
        active: false,
        nextAt: 0,
        last: '',
        archives: [],
      };
      jobs.push(cur);
      continue;
    }
    if (!cur) continue;
    const file = /^==FILE:(\S+) (\d+) (\d+)$/.exec(line);
    if (file) {
      if (ARCHIVE.test(file[1]!))
        cur.archives.push({ name: file[1]!, sizeBytes: Number(file[2]), at: Number(file[3]) });
      continue;
    }
    const sched = /^schedule=(daily|weekly) (\d{1,2})$/.exec(line);
    if (sched) {
      cur.frequency = sched[1] as 'daily' | 'weekly';
      cur.hour = Number(sched[2]);
    } else if (/^keep=\d+$/.test(line)) cur.keep = Number(line.slice(5));
    else if (line.startsWith('paths=')) cur.paths = line.slice(6).split(' ').filter(Boolean);
    else if (line === 'active=active') cur.active = true;
    else if (line.startsWith('next=')) {
      // "Sun 2026-11-15 03:00:00 UTC" (systemd's own format): let Date read it.
      const t = Date.parse(
        line
          .slice(5)
          .replace(/^\w{3} /, '')
          .replace(' UTC', 'Z')
          .replace(' ', 'T'),
      );
      cur.nextAt = Number.isNaN(t) ? 0 : Math.floor(t / 1000);
    } else if (line.startsWith('last=')) cur.last = line.slice(5);
  }
  for (const j of jobs) j.archives.sort((a, b) => b.at - a.at);
  return jobs;
}
