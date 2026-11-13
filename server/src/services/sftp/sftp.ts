import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { EDITOR_MAX_BYTES, type FileEntry, type FsErrorCode } from '@gfv/shared';
import type { Client, SFTPWrapper, Stats } from 'ssh2';
import type { Db } from '../../db/index.js';
import { snapshots } from '../../db/schema.js';
import type { SshPool } from '../../ssh/pool.js';
import { needsSnapshot, snapshotName } from './paths.js';

export class SftpError extends Error {
  constructor(
    readonly code: FsErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

const S_IFMT = 0o170000;
const kind = (mode: number): FileEntry['type'] =>
  (mode & S_IFMT) === 0o040000
    ? 'dir'
    : (mode & S_IFMT) === 0o100000
      ? 'file'
      : (mode & S_IFMT) === 0o120000
        ? 'symlink'
        : 'other';

/** SFTP status codes: 2 = no such file, 3 = permission denied, 4 = failure (also "exists" on some servers). */
function wrap(err: unknown): SftpError {
  if (err instanceof SftpError) return err;
  const code = (err as { code?: number | string }).code;
  if (code === 2 || code === 'ENOENT') return new SftpError('not_found');
  if (code === 3 || code === 'EACCES') return new SftpError('permission_denied');
  return new SftpError('failed', err instanceof Error ? err.message : 'sftp failed');
}

const call = <T>(fn: (cb: (err: Error | null | undefined, v: T) => void) => void): Promise<T> =>
  new Promise((resolve, reject) => fn((err, v) => (err ? reject(wrap(err)) : resolve(v))));

export interface SftpOptions {
  /** Saving a file under one of these first copies the old version aside. */
  snapshotPrefixes: readonly string[];
}

/**
 * Moves BYTES over SFTP: list, read, write, upload, download. This is the second sanctioned
 * exception to "everything goes through the Command Runner" (after the PTY): there is no
 * command to show, and piping binary through a shell would corrupt it. Operations that ARE
 * commands (mkdir, mv, chmod, rm) stay in the runner.
 */
export class SftpService {
  private channels = new WeakMap<Client, Promise<SFTPWrapper>>();

  constructor(
    private pool: SshPool,
    private db: Db,
    private opts: SftpOptions = { snapshotPrefixes: ['/etc'] },
  ) {}

  private async sftp(serverId: string): Promise<SFTPWrapper> {
    const client = this.pool.getClient(serverId);
    if (!client) throw new SftpError('not_connected');
    let p = this.channels.get(client);
    if (!p) {
      p = new Promise<SFTPWrapper>((resolve, reject) =>
        client.sftp((err, s) => (err ? reject(wrap(err)) : resolve(s))),
      );
      this.channels.set(client, p);
      // A failed or closed channel must not be cached forever.
      p.then((s) => s.on('close', () => this.channels.delete(client))).catch(() =>
        this.channels.delete(client),
      );
    }
    return p;
  }

  async home(serverId: string): Promise<string> {
    const s = await this.sftp(serverId);
    return call<string>((cb) => s.realpath('.', cb));
  }

  async list(serverId: string, path: string): Promise<FileEntry[]> {
    const s = await this.sftp(serverId);
    const items = await call<{ filename: string; attrs: Stats }[]>((cb) => s.readdir(path, cb));
    const base = path === '/' ? '' : path;
    const entries = await Promise.all(
      items
        .filter((i) => i.filename !== '.' && i.filename !== '..')
        .map(async (i): Promise<FileEntry> => {
          const type = kind(i.attrs.mode);
          const full = `${base}/${i.filename}`;
          let targetIsDir: boolean | undefined;
          if (type === 'symlink') {
            targetIsDir = await call<Stats>((cb) => s.stat(full, cb))
              .then((st) => kind(st.mode) === 'dir')
              .catch(() => false); // dangling link
          }
          return {
            name: i.filename,
            path: full,
            type,
            ...(targetIsDir !== undefined ? { targetIsDir } : {}),
            size: i.attrs.size,
            mtime: i.attrs.mtime * 1000,
            mode: (i.attrs.mode & 0o7777).toString(8).padStart(3, '0'),
          };
        }),
    );
    return entries;
  }

  async stat(
    serverId: string,
    path: string,
  ): Promise<{ type: FileEntry['type']; size: number } | null> {
    const s = await this.sftp(serverId);
    try {
      const st = await call<Stats>((cb) => s.stat(path, cb));
      return { type: kind(st.mode), size: st.size };
    } catch (e) {
      if (e instanceof SftpError && e.code === 'not_found') return null;
      throw e;
    }
  }

  /** For the Editor: the file as text, or a reason it can't be edited safely. */
  async readText(
    serverId: string,
    path: string,
  ): Promise<
    | { kind: 'text'; size: number; content: string }
    | { kind: 'unsupported'; size: number; reason: 'binary' | 'too_large' }
  > {
    const st = await this.stat(serverId, path);
    if (!st) throw new SftpError('not_found');
    if (st.type === 'dir') throw new SftpError('is_directory');
    if (st.size > EDITOR_MAX_BYTES)
      return { kind: 'unsupported', size: st.size, reason: 'too_large' };
    const s = await this.sftp(serverId);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const c of s.createReadStream(path) as AsyncIterable<Buffer>) {
      total += c.length;
      if (total > EDITOR_MAX_BYTES)
        return { kind: 'unsupported', size: total, reason: 'too_large' };
      chunks.push(c);
    }
    const buf = Buffer.concat(chunks);
    // NUL bytes or invalid UTF-8: saving the text back would corrupt the file.
    if (buf.includes(0)) return { kind: 'unsupported', size: buf.length, reason: 'binary' };
    try {
      return {
        kind: 'text',
        size: buf.length,
        content: new TextDecoder('utf-8', { fatal: true }).decode(buf),
      };
    } catch {
      return { kind: 'unsupported', size: buf.length, reason: 'binary' };
    }
  }

  async createReadStream(
    serverId: string,
    path: string,
  ): Promise<{ stream: Readable; size: number }> {
    const st = await this.stat(serverId, path);
    if (!st) throw new SftpError('not_found');
    if (st.type === 'dir') throw new SftpError('is_directory');
    const s = await this.sftp(serverId);
    return { stream: s.createReadStream(path), size: st.size };
  }

  /**
   * Writes `data` to `path`. Existing files are overwritten in place (keeps owner, mode and
   * symlinks). With `createOnly` it refuses to overwrite (uploads). Config files under a
   * protected prefix are copied aside first.
   */
  async write(
    serverId: string,
    path: string,
    data: Readable,
    opts: { createOnly?: boolean; maxBytes: number },
  ): Promise<{ size: number; snapshotted: boolean }> {
    const existing = await this.stat(serverId, path);
    if (existing?.type === 'dir') throw new SftpError('is_directory');
    if (existing && opts.createOnly) throw new SftpError('exists');

    let backup: { id: string; remotePath: string } | undefined;
    if (existing && needsSnapshot(path, this.opts.snapshotPrefixes)) {
      backup = await this.snapshot(serverId, path, existing.size);
    }

    const s = await this.sftp(serverId);
    let size = 0;
    const counter = async function* (src: Readable) {
      for await (const chunk of src as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > opts.maxBytes) throw new SftpError('too_large');
        yield chunk;
      }
    };
    try {
      await pipeline(
        data,
        counter,
        s.createWriteStream(path, { flags: opts.createOnly ? 'wx' : 'w' }),
      );
    } catch (e) {
      // The save failed (e.g. permission denied), so the file is unchanged: drop the backup
      // we just made instead of leaving a pointless entry in the timeline.
      if (backup) await this.discardSnapshot(serverId, backup);
      throw wrap(e);
    }
    return { size, snapshotted: !!backup };
  }

  /** Keep only the newest `keep` backups of one file: older rows and their copies on the server are deleted. */
  async prune(serverId: string, path: string, keep = 30): Promise<number> {
    const rows = this.db
      .select()
      .from(snapshots)
      .where(and(eq(snapshots.serverId, serverId), eq(snapshots.path, path)))
      .orderBy(desc(snapshots.createdAt))
      .all();
    const old = rows.slice(keep);
    for (const r of old) await this.discardSnapshot(serverId, r);
    return old.length;
  }

  /** Delete one backup (the row and the copy on the server). False if it is not this server's. */
  async deleteSnapshot(serverId: string, snapshotId: string): Promise<boolean> {
    const row = this.db.select().from(snapshots).where(eq(snapshots.id, snapshotId)).get();
    if (!row || row.serverId !== serverId) return false;
    await this.discardSnapshot(serverId, row);
    return true;
  }

  private async discardSnapshot(
    serverId: string,
    b: { id: string; remotePath: string },
  ): Promise<void> {
    this.db.delete(snapshots).where(eq(snapshots.id, b.id)).run();
    try {
      const s = await this.sftp(serverId);
      await call<void>((cb) => s.unlink(b.remotePath, cb));
    } catch {
      /* best effort */
    }
  }

  private async snapshot(
    serverId: string,
    path: string,
    size: number,
  ): Promise<{ id: string; remotePath: string }> {
    const s = await this.sftp(serverId);
    const gfvDir = `${await this.home(serverId)}/.gfv`;
    const dir = `${gfvDir}/snapshots`;
    // mkdir -p by hand: SFTP has no recursive mkdir. Errors for "already exists" are fine.
    for (const d of [gfvDir, dir]) {
      await call<void>((cb) => s.mkdir(d, { mode: 0o700 }, cb)).catch(() => {});
    }
    const when = Date.now();
    const remotePath = `${dir}/${snapshotName(path, when)}`;
    try {
      await pipeline(
        s.createReadStream(path),
        s.createWriteStream(remotePath, { flags: 'wx', mode: 0o600 }),
      );
    } catch (e) {
      // If we can't make the safety copy, we must not go on to overwrite the original.
      throw new SftpError('failed', `Could not save a snapshot first: ${wrap(e).message}`);
    }
    const id = randomUUID();
    this.db
      .insert(snapshots)
      .values({ id, serverId, path, remotePath, sizeBytes: size, createdAt: when })
      .run();
    await this.prune(serverId, path).catch(() => {});
    return { id, remotePath };
  }
}
