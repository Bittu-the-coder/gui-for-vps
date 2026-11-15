import { connect as tcp } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { testCtx, testKey } from '../testUtil.js';

// Cross-server copy on the two Docker VPSes: bytes really travel vps-a -> vps-b, nothing is overwritten.
const open = (port: number) =>
  new Promise<boolean>((ok) => {
    const s = tcp(port, '127.0.0.1');
    s.setTimeout(1500, () => (s.destroy(), ok(false)));
    s.on('connect', () => (s.end(), ok(true)));
    s.on('error', () => ok(false));
  });
const reachable = (await open(2201)) && (await open(2202));
const privateKey = testKey();
const H = { 'x-gfv-token': 't' };
vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!reachable)('transfer between servers (vps-a -> vps-b)', () => {
  const ctx = testCtx();
  let app: FastifyInstance;
  let a: string;
  let b: string;
  const dir = `/tmp/gfv-m22-${Date.now()}`;
  const call = (
    method: 'GET' | 'POST' | 'PUT',
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
  const remote = (id: string, cmd: string) =>
    new Promise<string>((res, rej) =>
      ctx.pool.getClient(id)!.exec(cmd, (e, st) => {
        if (e) return rej(e);
        let out = '';
        st.on('data', (d: Buffer) => (out += d));
        st.on('close', () => res(out.trim()));
      }),
    );
  const transfer = (from: string, fp: string, to: string, tp: string) =>
    call('POST', '/api/transfer', {
      from: { serverId: from, path: fp },
      to: { serverId: to, path: tp },
    });

  afterAll(async () => {
    for (const id of [a, b]) if (id) await remote(id, `rm -rf ${dir}`).catch(() => {});
    ctx.pool.disconnectAll();
    await app?.close();
  });

  it('copies a file (binary-safe) from one server to the other', async () => {
    app = await buildApp('t', ctx);
    await app.ready();
    await call('POST', '/api/vault/create', { password: 'master-pass' });
    const add = async (name: string, port: number) => {
      const id = (
        await call('POST', '/api/servers', {
          name,
          host: '127.0.0.1',
          port,
          username: 'gfv',
          authType: 'key',
          privateKey,
        })
      ).json().id;
      const first = (await call('POST', `/api/servers/${id}/connect`)).json();
      await call('POST', `/api/servers/${id}/trust-host-key`, { fingerprint: first.fingerprint });
      await call('POST', `/api/servers/${id}/connect`);
      return id as string;
    };
    a = await add('vps-a', 2201);
    b = await add('vps-b', 2202);
    await remote(a, `mkdir -p ${dir}`);
    await remote(b, `mkdir -p ${dir}`);
    // Bytes that are not valid UTF-8, to prove nothing re-encodes them.
    const bytes = Buffer.from([0, 255, 254, 1, 2, 200, 13, 10, 0x80, 65]);
    const up = await call(
      'PUT',
      `/api/servers/${a}/fs/file?path=${encodeURIComponent(`${dir}/blob.bin`)}&create=1`,
      bytes,
      'application/octet-stream',
    );
    expect(up.statusCode).toBe(200);

    const r = await transfer(a, `${dir}/blob.bin`, b, `${dir}/copy.bin`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().size).toBe(bytes.length);
    expect(await remote(b, `od -An -tx1 ${dir}/copy.bin | tr -d ' \\n'`)).toBe(
      bytes.toString('hex'),
    );
    expect(await remote(a, `test -e ${dir}/blob.bin && echo still-there`)).toBe('still-there'); // a copy, not a move
  });

  it('never overwrites: an existing destination is refused and left untouched', async () => {
    await remote(b, `printf original > ${dir}/keep.txt`);
    await remote(a, `printf new > ${dir}/keep.txt`);
    const r = await transfer(a, `${dir}/keep.txt`, b, `${dir}/keep.txt`);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('exists');
    expect(await remote(b, `cat ${dir}/keep.txt`)).toBe('original');
  });

  it('refuses folders, missing sources, the same file, and bad paths', async () => {
    expect((await transfer(a, dir, b, `${dir}/folder-copy`)).json().error).toBe('is_directory');
    expect((await transfer(a, `${dir}/nope`, b, `${dir}/x`)).statusCode).toBe(404);
    const same = await transfer(a, `${dir}/blob.bin`, a, `${dir}/blob.bin`);
    expect(same.statusCode).toBe(400);
    expect(same.json().error).toBe('same_file');
    expect((await transfer(a, 'relative/path', b, `${dir}/y`)).statusCode).toBe(400);
    expect((await call('POST', '/api/transfer', { from: { serverId: a } })).statusCode).toBe(400);
  });

  it('also copies within one server, and reports a disconnected one', async () => {
    expect((await transfer(a, `${dir}/blob.bin`, a, `${dir}/blob2.bin`)).statusCode).toBe(200);
    ctx.pool.disconnect(b);
    const off = await transfer(a, `${dir}/blob.bin`, b, `${dir}/z.bin`);
    expect(off.statusCode).toBe(409);
    expect(off.json().error).toBe('not_connected');
  });

  it('is locked while the vault is locked', async () => {
    await call('POST', '/api/vault/lock');
    expect((await transfer(a, '/x', b, '/y')).statusCode).toBe(423);
  });
});
