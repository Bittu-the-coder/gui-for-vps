import { z } from 'zod';
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
    'Renames a file or folder (or moves it to another folder). The -n flag means it will not overwrite something that already has the new name.',
  params: z.object({ from: absPath, to: absPath }),
  commands: ({ from, to }) => [`mv -n -- ${shellQuote(from)} ${shellQuote(to)}`],
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
