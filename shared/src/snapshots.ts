import { shellQuote } from './shell.js';

/** Name of the backup file for `path`, made during run `runId`: one flat, safe filename. */
export function snapshotFileName(runId: string, path: string): string {
  return `${runId}__${path.replace(/^\/+/, '').replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

/** The line the backup step prints on success; the runner reads it to record the snapshot. */
export const SNAPSHOT_SAVED = /^Snapshot saved: (\S+) \((\d+) bytes\)$/m;

/**
 * Backup commands, shown in the preview BEFORE the action's own commands. The copy is made by
 * `cat` with a redirect, so the file belongs to the SSH user (readable for diffs) even when
 * reading the original needs sudo.
 */
export function snapshotCommands(path: string, runId: string, sudo: string): string[] {
  const name = snapshotFileName(runId, path);
  const dest = `"$HOME/.gfv/snapshots/${name}"`;
  const p = shellQuote(path);
  return [
    'mkdir -p -m 700 "$HOME/.gfv" "$HOME/.gfv/snapshots"',
    `if [ -e ${p} ]; then ${sudo}cat -- ${p} > ${dest} && chmod 600 ${dest} && echo "Snapshot saved: ${name} ($(wc -c < ${dest}) bytes)" || { rm -f ${dest}; echo ${shellQuote(`Could not back up ${path}`)} >&2; exit 1; }; else echo ${shellQuote(`${path} does not exist yet: nothing to back up`)}; fi`,
  ];
}

/** Snapshots must live in the user's own ~/.gfv/snapshots; restore refuses anything else. */
export const SNAPSHOT_PATH = /^\/(?:[^/\0]+\/)*\.gfv\/snapshots\/[A-Za-z0-9._-]+$/;
