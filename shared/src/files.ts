import { z } from 'zod';

/** File Manager / Editor protocol (SFTP-backed routes under /api/servers/:id/fs). */

export const FileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['file', 'dir', 'symlink', 'other']),
  /** For symlinks: does the link point at a folder? (so the UI can open it) */
  targetIsDir: z.boolean().optional(),
  size: z.number(),
  /** Milliseconds since epoch. */
  mtime: z.number(),
  /** Permission bits as octal text, e.g. "644". */
  mode: z.string(),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;

export const ListResponseSchema = z.object({
  /** The resolved absolute path (so "~" comes back as the real home folder). */
  path: z.string(),
  home: z.string(),
  entries: z.array(FileEntrySchema),
});
export type ListResponse = z.infer<typeof ListResponseSchema>;

export const ReadResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), path: z.string(), size: z.number(), content: z.string() }),
  /** Not editable: binary data, not valid UTF-8, or too big. */
  z.object({
    kind: z.literal('unsupported'),
    path: z.string(),
    size: z.number(),
    reason: z.enum(['binary', 'too_large']),
  }),
]);
export type ReadResponse = z.infer<typeof ReadResponseSchema>;

export const WriteResponseSchema = z.object({
  size: z.number(),
  /** A copy of the previous version was saved on the server first (config snapshot). */
  snapshotted: z.boolean(),
});
export type WriteResponse = z.infer<typeof WriteResponseSchema>;

export const FsErrorCodeSchema = z.enum([
  'not_connected',
  'not_found',
  'permission_denied',
  'exists',
  'is_directory',
  'too_large',
  'invalid_path',
  'failed',
]);
export type FsErrorCode = z.infer<typeof FsErrorCodeSchema>;

/** Limits. */
export const EDITOR_MAX_BYTES = 5 * 1024 * 1024;
export const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
