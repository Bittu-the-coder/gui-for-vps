import { z } from 'zod';
import { SNAPSHOT_PATH } from '../snapshots.js';
import { shellQuote } from '../shell.js';
import { defineAction } from './define.js';

/**
 * File Manager actions that ARE shell commands, so they go through the Command Runner
 * (Learn Mode shows the real mkdir/mv/chmod). Moving bytes (list/read/write/upload/download)
 * uses SFTP instead, see server/src/services/sftp.
 */

const absPath = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^\//, 'must be an absolute path starting with /')
  .refine((p) => !p.includes('\0'), 'invalid path');

export const writeRoot = defineAction({
  id: 'files.write-root',
  title: 'Save a file as administrator',
  explain:
    'Your text was uploaded to a temporary file. This copies it over the real file with sudo. Copying onto an existing file keeps its owner and permissions. The previous version is backed up first, and the temporary file is deleted afterwards.',
  params: z.object({
    path: absPath,
    tmp: z.string().regex(/^\/tmp\/gfv-save-[A-Za-z0-9]{8,32}$/, 'not a GFV temporary file'),
  }),
  snapshotPaths: ({ path }) => [path],
  commands: ({ path, tmp }, ctx) => [
    `${ctx.sudo}cp -- ${shellQuote(tmp)} ${shellQuote(path)}`,
    `rm -f -- ${shellQuote(tmp)}`,
  ],
  risk: 'caution',
  riskReason:
    'Overwrites a file with administrator rights. A mistake in a system file can break services or lock you out.',
  recordable: false, // the new content is not part of a recipe
  internal: true,
});

export const restoreSnapshot = defineAction({
  id: 'files.restore-snapshot',
  title: 'Restore an earlier version of a file',
  explain:
    'Copies a backup GFV made earlier (in ~/.gfv/snapshots) back over the file. The current version is backed up first, so you can undo this restore too.',
  params: z.object({
    path: absPath,
    snapshot: z
      .string()
      .max(4096)
      .regex(SNAPSHOT_PATH, 'must be one of GFV’s own snapshots')
      .refine((p) => !p.includes('..'), 'invalid path'),
  }),
  snapshotPaths: ({ path }) => [path],
  commands: ({ path, snapshot }, ctx) => [
    `${ctx.sudo}cp -- ${shellQuote(snapshot)} ${shellQuote(path)}`,
  ],
  risk: 'caution',
  riskReason: 'Replaces the current content of the file with an older version.',
  recordable: false,
  internal: true,
});

export const makeDir = defineAction({
  id: 'files.mkdir',
  title: 'Create a folder',
  explain:
    'Creates a new folder. The -p flag means missing parent folders are created too, and it is not an error if the folder already exists.',
  params: z.object({ path: absPath }),
  commands: ({ path }) => [`mkdir -p -- ${shellQuote(path)}`],
  risk: 'safe',
  recordable: true,
  internal: true,
});

export const renamePath = defineAction({
  id: 'files.rename',
  title: 'Rename or move',
  explain:
    'Renames a file or folder (or moves it to another folder). The -n flag means it will not overwrite something that already has the new name, and -T means the new name is always the exact final name (never "move into that folder").',
  params: z.object({ from: absPath, to: absPath }),
  commands: ({ from, to }) => [`mv -nT -- ${shellQuote(from)} ${shellQuote(to)}`],
  // In a script that may run twice: skip when the source is already gone.
  exportCommands: ({ from, to }) => [
    `if [ -e ${shellQuote(from)} ] && [ ! -e ${shellQuote(to)} ]; then mv -nT -- ${shellQuote(from)} ${shellQuote(to)}; else echo ${shellQuote(`Skipped: ${from} is missing or ${to} already exists (already renamed?)`)}; fi`,
  ],
  risk: 'safe',
  recordable: true,
  internal: true,
});

export const chmodPath = defineAction({
  id: 'files.chmod',
  title: 'Change permissions',
  explain:
    'Changes who may read (4), write (2) and execute (1) a file. The three digits are the owner, the group and everyone else; add the numbers per person, so 644 means the owner can read and write, everyone else can only read.',
  params: z.object({
    path: absPath,
    mode: z.string().regex(/^[0-7]{3,4}$/, 'use 3 or 4 octal digits, like 644 or 755'),
    recursive: z.boolean().optional(),
  }),
  commands: ({ path, mode, recursive }) => [
    `chmod ${recursive ? '-R ' : ''}${mode} -- ${shellQuote(path)}`,
  ],
  risk: 'caution',
  riskReason:
    'Wrong permissions can lock you out of your own files, or expose private files to everyone.',
  recordable: true,
  internal: true,
});
