import { readFileSync } from 'node:fs';
import { connect as tcp } from 'node:net';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { snapshots } from '../db/schema.js';
import { SftpService } from '../services/sftp/sftp.js';
import { testCtx } from '../testUtil.js';

// Integration tests: SFTP file routes against the Docker test VPS (vps-a, 127.0.0.1:2201).
const PORT = 2201;
const reachable = await new Promise<boolean>((ok) => {
  const s = tcp(PORT, '127.0.0.1');
  s.setTimeout(1500, () => (s.destroy(), ok(false)));
  s.on('connect', () => (s.end(), ok(true)));
  s.on('error', () => ok(false));
});
const privateKey = readFileSync(resolve(__dirname, '../../../e2e/keys/id_test'), 'utf8');
const H = { 'x-gfv-token': 't' };
vi.setConfig({ testTimeout: 30_000 });

describe.skipIf(!reachable)('files over SFTP (vps-a)', () => {
  const ctx = testCtx();
  const dir = `/tmp/gfv-files-${Date.now()}`;
  // /etc isn't writable by the test user, so the snapshot rule is exercised on a /tmp folder.
  ctx.sftp = new SftpService(ctx.pool, ctx.db, { snapshotPrefixes: [`${dir}/conf`] });
  let app: FastifyInstance;
  let id: string;

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: object | Buffer,
    type?: string,
  ) =>
    app.inject({
      method,
      url,
      headers: { ...H, ...(type ? { 'content-type': type } : {}) },
      payload,
    });
  const fs = (op: string, path: string, extra = '') =>
    `/api/servers/${id}/fs/${op}?path=${encodeURIComponent(path)}${extra}`;
  const put = (path: string, body: string | Buffer, extra = '') =>
    call('PUT', fs('file', path, extra), Buffer.from(body), 'application/octet-stream');
  const run = async (actionId: string, params: object) => {
    const r = await call('POST', '/api/runs', { serverId: id, actionId, params, confirmed: true });
    const runner = ctx.runner.get(r.json().runId)!;
    await runner.done;
    return runner.exitCode;
  };

  afterAll(async () => {
    await run('files.delete-path', { path: dir }).catch(() => {});
    ctx.pool.disconnectAll();
    await app?.close();
  });

  it('sets up', async () => {
    app = await buildApp('t', ctx);
    await app.ready();
    await call('POST', '/api/vault/create', { password: 'master-pass' });
    id = (
      await call('POST', '/api/servers', {
        name: 'vps-a',
        host: '127.0.0.1',
        port: PORT,
        username: 'gfv',
        authType: 'key',
        privateKey,
      })
    ).json().id;
    const first = (await call('POST', `/api/servers/${id}/connect`)).json();
    await call('POST', `/api/servers/${id}/trust-host-key`, { fingerprint: first.fingerprint });
    expect((await call('POST', `/api/servers/${id}/connect`)).json().status).toBe('connected');
    expect(await run('files.mkdir', { path: `${dir}/conf` })).toBe(0);
  });

  it('lists a folder, resolving ~ to the home directory', async () => {
    const r = (await call('GET', `/api/servers/${id}/fs/list?path=~`)).json();
    expect(r.path).toBe('/home/gfv');
    expect(r.home).toBe('/home/gfv');
    expect(r.entries.some((e: { name: string }) => e.name === '.bashrc')).toBe(true);
    const tmp = (await call('GET', fs('list', dir))).json();
    expect(tmp.entries).toEqual([
      expect.objectContaining({ name: 'conf', type: 'dir', path: `${dir}/conf` }),
    ]);
  });

  it('uploads, reads back and downloads identical bytes (binary safe)', async () => {
    const bytes = Buffer.from([0, 255, 1, 254, 10, 13, 128]);
    const up = await put(`${dir}/blob.bin`, bytes, '&create=1');
    expect(up.statusCode).toBe(200);
    expect(up.json()).toEqual({ size: 7, snapshotted: false });
    const dl = await call('GET', fs('download', `${dir}/blob.bin`));
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.equals(bytes)).toBe(true);
    expect(dl.headers['content-disposition']).toContain('blob.bin');
    const rd = (await call('GET', fs('read', `${dir}/blob.bin`))).json();
    expect(rd).toMatchObject({ kind: 'unsupported', reason: 'binary' });
  });

  it('refuses to overwrite on upload, but a save overwrites', async () => {
    expect((await put(`${dir}/a.txt`, 'one', '&create=1')).statusCode).toBe(200);
    const again = await put(`${dir}/a.txt`, 'two', '&create=1');
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('exists');
    expect((await put(`${dir}/a.txt`, 'héllo ✓\n')).statusCode).toBe(200);
    expect((await call('GET', fs('read', `${dir}/a.txt`))).json()).toMatchObject({
      kind: 'text',
      content: 'héllo ✓\n',
    });
  });

  it('snapshots a protected file before overwriting it, and records it', async () => {
    const f = `${dir}/conf/app.conf`;
    expect((await put(f, 'v1')).json().snapshotted).toBe(false); // new file: nothing to back up
    const second = await put(f, 'v2');
    expect(second.json()).toEqual({ size: 2, snapshotted: true });
    const rows = ctx.db.select().from(snapshots).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path: f, sizeBytes: 2 });
    // The copy on the server holds the OLD content.
    const copy = await ctx.sftp.readText(id, rows[0]!.remotePath);
    expect(copy).toMatchObject({ kind: 'text', content: 'v1' });
    expect(rows[0]!.remotePath).toMatch(/^\/home\/gfv\/\.gfv\/snapshots\//);
  });

  it('keeps only the newest backups of a file (prune), and a single backup can be deleted', async () => {
    const f = `${dir}/conf/prune.conf`;
    for (const v of ['v1', 'v2', 'v3', 'v4', 'v5']) {
      await new Promise((r) => setTimeout(r, 5)); // distinct timestamps
      expect((await put(f, v)).statusCode).toBe(200);
    }
    const mine = () =>
      ctx.db
        .select()
        .from(snapshots)
        .all()
        .filter((r) => r.path === f);
    expect(mine()).toHaveLength(4); // v1 was the first write (nothing to back up)
    const oldest = [...mine()].sort((a, b) => a.createdAt - b.createdAt).slice(0, 2);
    expect(await ctx.sftp.prune(id, f, 2)).toBe(2);
    expect(mine()).toHaveLength(2);
    for (const r of oldest) expect(await ctx.sftp.stat(id, r.remotePath)).toBeNull(); // copies are gone too

    const keep = mine()[0]!;
    expect((await call('DELETE', `/api/servers/${id}/snapshots/${keep.id}`)).statusCode).toBe(200);
    expect(await ctx.sftp.stat(id, keep.remotePath)).toBeNull();
    expect((await call('DELETE', `/api/servers/${id}/snapshots/${keep.id}`)).statusCode).toBe(404);
    expect((await call('DELETE', `/api/servers/other/snapshots/${mine()[0]!.id}`)).statusCode).toBe(
      404,
    );
  });

  it('a refused save (read-only file) leaves no stray backup behind', async () => {
    const f = `${dir}/conf/readonly.conf`;
    expect((await put(f, 'locked')).statusCode).toBe(200);
    expect(await run('files.chmod', { path: f, mode: '444' })).toBe(0);
    const before = ctx.db.select().from(snapshots).all().length;
    const r = await put(f, 'changed');
    expect(r.statusCode).toBe(403);
    expect(ctx.db.select().from(snapshots).all()).toHaveLength(before);
    expect((await call('GET', fs('read', f))).json()).toMatchObject({ content: 'locked' });
  });

  it('maps errors: missing, directory, permission, bad path, wrong content type', async () => {
    expect((await call('GET', fs('read', `${dir}/nope`))).statusCode).toBe(404);
    expect((await call('GET', fs('read', dir))).statusCode).toBe(400);
    expect((await put('/etc/gfv-test', 'x')).statusCode).toBe(403);
    expect((await call('GET', `/api/servers/${id}/fs/list?path=relative`)).statusCode).toBe(400);
    expect((await call('PUT', fs('file', `${dir}/x`), { a: 1 })).statusCode).toBe(415);
  });

  it('rename, chmod and delete go through the runner', async () => {
    expect(await run('files.rename', { from: `${dir}/a.txt`, to: `${dir}/b.txt` })).toBe(0);
    expect(await run('files.chmod', { path: `${dir}/b.txt`, mode: '600' })).toBe(0);
    const entries = (await call('GET', fs('list', dir))).json().entries;
    expect(entries.find((e: { name: string }) => e.name === 'b.txt')).toMatchObject({
      mode: '600',
    });
    expect(entries.some((e: { name: string }) => e.name === 'a.txt')).toBe(false);
    // renaming onto an existing name fails instead of overwriting
    expect(await run('files.rename', { from: `${dir}/b.txt`, to: `${dir}/blob.bin` })).not.toBe(0);
    expect(await run('files.delete-path', { path: `${dir}/b.txt` })).toBe(0);
  });
});
