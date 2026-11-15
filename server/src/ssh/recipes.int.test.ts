import { spawnSync } from 'node:child_process';
import { connect as tcp } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { snapshots } from '../db/schema.js';
import { testCtx, testKey } from '../testUtil.js';

// Integration for M8 on the Docker test VPSes: sudo-save + snapshots + restore on vps-a, and
// record -> export -> RUN THE SCRIPT ON THE CLEAN vps-b (the milestone check).
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

describe.skipIf(!reachable)('snapshots and recipes (vps-a, vps-b)', () => {
  const ctx = testCtx();
  let app: FastifyInstance;
  let a: string;
  let b: string;
  const stamp = Date.now();
  const etcFile = `/etc/gfv-m8-${stamp}.conf`;
  const work = `/tmp/gfv-m8r-${stamp}`;

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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
  const remote = (id: string, cmd: string, stdin?: string) =>
    new Promise<{ code: number; out: string; err: string }>((res, rej) =>
      ctx.pool.getClient(id)!.exec(cmd, (e, st) => {
        if (e) return rej(e);
        let out = '';
        let err = '';
        st.on('data', (d: Buffer) => (out += d));
        st.stderr.on('data', (d: Buffer) => (err += d));
        st.on('close', (code: number) => res({ code, out: out.trim(), err: err.trim() }));
        if (stdin !== undefined) st.end(stdin);
      }),
    );
  /** Run an action through the runner and wait for it. */
  const run = async (serverId: string, actionId: string, params: object = {}) => {
    const r = await call('POST', '/api/runs', { serverId, actionId, params, confirmed: true });
    expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
    const rr = ctx.runner.get(r.json().runId)!;
    await rr.done;
    return rr;
  };
  const saveAsRoot = async (path: string, text: string) => {
    const tmp = `/tmp/gfv-save-${Math.random().toString(16).slice(2, 14)}`;
    const up = await call(
      'PUT',
      `/api/servers/${a}/fs/file?path=${encodeURIComponent(tmp)}&create=1`,
      Buffer.from(text),
      'application/octet-stream',
    );
    expect(up.statusCode).toBe(200);
    return { run: await run(a, 'files.write-root', { path, tmp }), tmp };
  };
  const readFile = async (id: string, path: string) =>
    (await call('GET', `/api/servers/${id}/fs/read?path=${encodeURIComponent(path)}`)).json();

  afterAll(async () => {
    await remote(a, `sudo rm -f ${etcFile}; rm -rf ${work}`).catch(() => {});
    await remote(b, `rm -rf ${work}`).catch(() => {});
    ctx.pool.disconnectAll();
    await app?.close();
  });

  it('sets up two servers', async () => {
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
      expect((await call('POST', `/api/servers/${id}/connect`)).json().status).toBe('connected');
      return id as string;
    };
    a = await add('vps-a', 2201);
    b = await add('vps-b', 2202);
  });

  describe('sudo-save, snapshots, restore', () => {
    it('creating a new root-owned file backs nothing up; overwriting it does, readable by the user', async () => {
      const first = await saveAsRoot(etcFile, 'version 1\n');
      expect(first.run.exitCode, first.run.outputTail).toBe(0);
      expect(ctx.db.select().from(snapshots).all()).toHaveLength(0);
      expect((await remote(a, `stat -c '%U' ${etcFile}`)).out).toBe('root');
      expect((await remote(a, `test -e ${first.tmp} && echo left || echo gone`)).out).toBe('gone');

      const second = await saveAsRoot(etcFile, 'version 2\n');
      expect(second.run.exitCode, second.run.outputTail).toBe(0);
      const rows = ctx.db.select().from(snapshots).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        serverId: a,
        path: etcFile,
        source: 'files.write-root',
        sizeBytes: 10,
        runId: second.run.id,
      });
      expect(rows[0]!.remotePath).toBe(
        `/home/gfv/.gfv/snapshots/${second.run.id}__etc_gfv-m8-${stamp}.conf`,
      );
      // The backup holds the OLD content and the user can read it (that is what the diff view uses).
      expect(await readFile(a, rows[0]!.remotePath)).toMatchObject({
        kind: 'text',
        content: 'version 1\n',
      });
      expect(await readFile(a, etcFile)).toMatchObject({ content: 'version 2\n' });
      // The timeline API lists it
      const list = (await call('GET', `/api/servers/${a}/snapshots`)).json();
      expect(list).toHaveLength(1);
      expect(list[0].path).toBe(etcFile);
    });

    it('the preview shows the backup commands first', async () => {
      const p = (
        await call('POST', '/api/runs/preview', {
          serverId: a,
          actionId: 'files.write-root',
          params: { path: etcFile, tmp: '/tmp/gfv-save-abcdef123456' },
        })
      ).json();
      expect(p.commands[0]).toContain('mkdir -p -m 700');
      expect(p.commands[1]).toContain('sudo -n cat --');
      expect(p.snapshots).toHaveLength(1);
    });

    it('restore puts the old version back, backs up the current one first, and can itself be undone', async () => {
      const [snap] = ctx.db.select().from(snapshots).all();
      const restore = await run(a, 'files.restore-snapshot', {
        path: etcFile,
        snapshot: snap!.remotePath,
      });
      expect(restore.exitCode, restore.outputTail).toBe(0);
      expect(await readFile(a, etcFile)).toMatchObject({ content: 'version 1\n' });
      const rows = ctx.db.select().from(snapshots).all();
      expect(rows).toHaveLength(2);
      const undo = rows.find((r) => r.source === 'files.restore-snapshot')!;
      expect(await readFile(a, undo.remotePath)).toMatchObject({ content: 'version 2\n' });
      // undo the restore
      expect(
        (await run(a, 'files.restore-snapshot', { path: etcFile, snapshot: undo.remotePath }))
          .exitCode,
      ).toBe(0);
      expect(await readFile(a, etcFile)).toMatchObject({ content: 'version 2\n' });
    });

    it('refuses to restore from anywhere but GFV snapshots, and needs confirmation', async () => {
      const bad = await call('POST', '/api/runs', {
        serverId: a,
        actionId: 'files.restore-snapshot',
        params: { path: etcFile, snapshot: '/etc/shadow' },
        confirmed: true,
      });
      expect(bad.statusCode).toBe(400);
      const noConfirm = await call('POST', '/api/runs', {
        serverId: a,
        actionId: 'files.restore-snapshot',
        params: { path: etcFile, snapshot: '/home/gfv/.gfv/snapshots/x' },
      });
      expect(noConfirm.statusCode).toBe(403);
    });

    it('a failing backup aborts the action before anything is overwritten', async () => {
      // /etc/shadow is not readable even with... sudo can read it, so use a path that cat fails on: a directory
      const tmp = `/tmp/gfv-save-${Math.random().toString(16).slice(2, 14)}`;
      await call(
        'PUT',
        `/api/servers/${a}/fs/file?path=${encodeURIComponent(tmp)}&create=1`,
        Buffer.from('x'),
        'application/octet-stream',
      );
      const r = await run(a, 'files.write-root', { path: '/etc/ssh', tmp }); // cat of a directory fails
      expect(r.exitCode).not.toBe(0);
      expect((await remote(a, 'test -d /etc/ssh && echo still-a-dir')).out).toBe('still-a-dir');
      await remote(a, `rm -f ${tmp}`);
    });
  });

  describe('record -> export -> run on a fresh server', () => {
    let recipeId: string;

    it('records only successful, recordable runs on the recording server', async () => {
      expect((await call('GET', '/api/recording')).json()).toEqual({ active: null });
      const start = await call('POST', '/api/recording/start', { serverId: a, name: 'M8 test' });
      expect(start.statusCode).toBe(200);
      recipeId = start.json().recipeId;
      expect((await call('POST', '/api/recording/start', { serverId: a })).statusCode).toBe(409);

      expect((await run(a, 'files.mkdir', { path: `${work}/app` })).exitCode).toBe(0);
      expect((await run(a, 'files.mkdir', { path: `${work}/app/data dir` })).exitCode).toBe(0);
      expect((await run(a, 'files.chmod', { path: `${work}/app`, mode: '750' })).exitCode).toBe(0);
      expect(
        (await run(a, 'files.rename', { from: `${work}/app/data dir`, to: `${work}/app/data` }))
          .exitCode,
      ).toBe(0);
      // not recorded: not recordable / failed / another server / cancelled-by-nature
      expect((await run(a, 'system.uptime')).exitCode).toBe(0);
      expect(
        (await run(a, 'files.chmod', { path: `${work}/does-not-exist`, mode: '700' })).exitCode,
      ).not.toBe(0);
      expect((await run(b, 'files.mkdir', { path: `${work}/other-server` })).exitCode).toBe(0);

      expect((await call('GET', '/api/recording')).json()).toMatchObject({
        active: { recipeId, stepCount: 4, name: 'M8 test' },
      });
      expect((await call('POST', '/api/recording/stop')).statusCode).toBe(200);
      expect((await call('POST', '/api/recording/stop')).statusCode).toBe(409);
      expect((await call('GET', '/api/recording')).json()).toEqual({ active: null });

      const r = (await call('GET', `/api/recipes/${recipeId}`)).json();
      expect(r.steps.map((s: { actionId: string }) => s.actionId)).toEqual([
        'files.mkdir',
        'files.mkdir',
        'files.chmod',
        'files.rename',
      ]);
      expect(r.steps.map((s: { position: number }) => s.position)).toEqual([0, 1, 2, 3]);
      // later runs are not recorded once stopped
      await run(a, 'files.mkdir', { path: `${work}/after-stop` });
      expect((await call('GET', `/api/recipes/${recipeId}`)).json().steps).toHaveLength(4);
    });

    it('rename, reorder and delete steps', async () => {
      expect(
        (await call('PATCH', `/api/recipes/${recipeId}`, { name: 'My stack' })).statusCode,
      ).toBe(200);
      const steps = (await call('GET', `/api/recipes/${recipeId}`)).json().steps as {
        id: string;
      }[];
      const ids = steps.map((s) => s.id);
      expect(
        (
          await call('POST', `/api/recipes/${recipeId}/steps/reorder`, {
            order: [...ids].reverse(),
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await call('GET', `/api/recipes/${recipeId}`))
          .json()
          .steps.map((s: { id: string }) => s.id),
      ).toEqual([...ids].reverse());
      expect(
        (await call('POST', `/api/recipes/${recipeId}/steps/reorder`, { order: ids.slice(1) }))
          .statusCode,
      ).toBe(400);
      expect(
        (await call('POST', `/api/recipes/${recipeId}/steps/reorder`, { order: ids })).statusCode,
      ).toBe(200);
      expect((await call('DELETE', `/api/recipes/${recipeId}/steps/nope`)).statusCode).toBe(404);
      expect((await call('GET', '/api/recipes')).json()).toEqual([
        expect.objectContaining({ id: recipeId, name: 'My stack', stepCount: 4 }),
      ]);
    });

    it('the exported script is valid bash and, run on the CLEAN vps-b, rebuilds the setup (twice is fine)', async () => {
      const { script, filename } = (await call('GET', `/api/recipes/${recipeId}/export`)).json();
      expect(filename).toBe('My-stack.sh');
      const syntax = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
      expect(syntax.status, syntax.stderr).toBe(0);
      expect(script).not.toContain('sudo -n');
      expect(script).not.toContain('.gfv/snapshots');
      expect(script).toContain('recorded on vps-a');

      // vps-b has none of this yet
      expect((await remote(b, `test -e ${work}/app && echo yes || echo no`)).out).toBe('no');
      const first = await remote(b, 'bash -s', script);
      expect(first.code, `${first.out}\n${first.err}`).toBe(0);
      expect(first.out).toContain('==> Step 4/4');
      expect((await remote(b, `stat -c '%a' ${work}/app`)).out).toBe('750');
      expect((await remote(b, `test -d '${work}/app/data' && echo ok`)).out).toBe('ok');
      expect((await remote(b, `test -e '${work}/app/data dir' && echo bad || echo ok`)).out).toBe(
        'ok',
      );

      // Running it again must not fail (mkdir -p, chmod, and the guarded rename)
      const second = await remote(b, 'bash -s', script);
      expect(second.code, `${second.out}\n${second.err}`).toBe(0);
      expect(second.out).toContain('Skipped:');
    });

    it('deleting a recipe removes its steps; 404 afterwards', async () => {
      expect((await call('DELETE', `/api/recipes/${recipeId}`)).statusCode).toBe(200);
      expect((await call('GET', `/api/recipes/${recipeId}`)).statusCode).toBe(404);
      expect((await call('GET', `/api/recipes/${recipeId}/export`)).statusCode).toBe(404);
    });
  });
});
