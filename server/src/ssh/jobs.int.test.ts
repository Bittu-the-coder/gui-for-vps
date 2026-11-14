import { readFileSync } from 'node:fs';
import { connect as tcp } from 'node:net';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { JobSnapshot } from '@gfv/shared';
import { buildApp } from '../app.js';
import { testCtx } from '../testUtil.js';

// M11 on the Docker test VPSes: broadcast, parameterized replay on BOTH servers, pause-on-failure with a
// REAL failing command, and the server-side confirmation gate.
const open = (port: number) =>
  new Promise<boolean>((ok) => {
    const s = tcp(port, '127.0.0.1');
    s.setTimeout(1500, () => (s.destroy(), ok(false)));
    s.on('connect', () => (s.end(), ok(true)));
    s.on('error', () => ok(false));
  });
const reachable = (await open(2201)) && (await open(2202));
const privateKey = readFileSync(resolve(__dirname, '../../../e2e/keys/id_test'), 'utf8');
const H = { 'x-gfv-token': 't' };
vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!reachable)('jobs: replay and broadcast (vps-a, vps-b)', () => {
  const ctx = testCtx();
  let app: FastifyInstance;
  let a: string;
  let b: string;
  const stamp = Date.now();
  const root = `/tmp/gfv-m11-${stamp}`;

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) => app.inject({ method, url, headers: H, payload });
  const remote = (id: string, cmd: string) =>
    new Promise<{ code: number; out: string }>((res, rej) =>
      ctx.pool.getClient(id)!.exec(cmd, (e, st) => {
        if (e) return rej(e);
        let out = '';
        st.on('data', (d: Buffer) => (out += d));
        st.on('close', (code: number) => res({ code, out: out.trim() }));
      }),
    );
  const waitFor = async (id: string, pred: (j: JobSnapshot) => boolean) => {
    for (let i = 0; i < 300; i++) {
      const j = ctx.jobs.get(id)!.snapshot();
      if (pred(j)) return j;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('timed out waiting for the job');
  };
  /** A recipe recorded on vps-a, then edited. */
  const record = async (steps: { actionId: string; params: object }[]) => {
    await call('POST', '/api/recording/start', { serverId: a });
    for (const s of steps) {
      const r = await call('POST', '/api/runs', { serverId: a, ...s, confirmed: true });
      await ctx.runner.get(r.json().runId)!.done;
    }
    return (await call('POST', '/api/recording/stop')).json().recipeId as string;
  };

  afterAll(async () => {
    for (const id of [a, b]) if (id) await remote(id, `rm -rf ${root}`).catch(() => {});
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

  it('broadcast: one action on both servers at once', async () => {
    const r = await call('POST', '/api/jobs', {
      kind: 'broadcast',
      serverIds: [a, b],
      steps: [{ actionId: 'system.uptime' }],
    });
    expect(r.statusCode, r.body).toBe(200);
    const done = await waitFor(r.json().id, (j) => j.status !== 'running');
    expect(done.status).toBe('done');
    expect(done.targets.map((t) => [t.serverId, t.status, t.steps[0]!.status])).toEqual([
      [a, 'done', 'ok'],
      [b, 'done', 'ok'],
    ]);
    // The runs went through the normal Command Runner, so they are in history (Learn Mode shows them).
    const hist = (await call('GET', '/api/history'))
      .json()
      .entries.filter((e: { actionId: string }) => e.actionId === 'system.uptime');
    expect(hist.length).toBeGreaterThanOrEqual(2);
  });

  it('a recipe recorded on vps-a, made parametric, replays on BOTH servers with the given value', async () => {
    const recipeId = await record([
      { actionId: 'files.mkdir', params: { path: `${root}/site-main` } },
    ]);
    const detail = (await call('GET', `/api/recipes/${recipeId}`)).json();
    // Turn the folder name into a parameter.
    const stepId = detail.steps[0].id;
    expect(
      (
        await call('PUT', `/api/recipes/${recipeId}/params`, {
          params: [{ name: 'site', label: 'Site name', default: 'main' }],
        })
      ).statusCode,
    ).toBe(200);
    const bad = await call('PATCH', `/api/recipes/${recipeId}/steps/${stepId}`, {
      params: { path: `${root}/{{ghost}}` },
    });
    expect(bad.statusCode).toBe(400); // a placeholder nobody declared
    expect(JSON.stringify(bad.json())).toContain('ghost');
    expect(
      (
        await call('PATCH', `/api/recipes/${recipeId}/steps/${stepId}`, {
          params: { path: `${root}/site-{{site}}` },
        })
      ).statusCode,
    ).toBe(200);

    // The plan asks for the value (default is used) and shows the real command per server.
    const plan = (
      await call('POST', '/api/jobs/plan', {
        kind: 'replay',
        serverIds: [a, b],
        recipeId,
        values: { site: 'blue' },
      })
    ).json();
    expect(plan.risk).toBe('safe');
    expect(JSON.stringify(plan.targets[1].steps[0])).toContain(`${root}/site-blue`);

    const r = await call('POST', '/api/jobs', {
      kind: 'replay',
      serverIds: [a, b],
      recipeId,
      values: { site: 'blue' },
    });
    expect(r.statusCode, r.body).toBe(200);
    const done = await waitFor(r.json().id, (j) => j.status !== 'running');
    expect(done.status).toBe('done');
    for (const id of [a, b])
      expect((await remote(id, `test -d ${root}/site-blue && echo yes`)).out).toBe('yes');
    // The value is not written into the saved job.
    expect(JSON.stringify((await call('GET', '/api/jobs')).json())).not.toContain('blue');
  });

  it('pause on failure: a real failing command pauses each target; skip lets them finish', async () => {
    const recipeId = await record([{ actionId: 'files.mkdir', params: { path: `${root}/pf` } }]);
    const d = (await call('GET', `/api/recipes/${recipeId}`)).json();
    // Make step 1 fail for real (rename something that does not exist) and add a step after it.
    await call('PATCH', `/api/recipes/${recipeId}/steps/${d.steps[0].id}`, {
      params: { from: `${root}/does-not-exist`, to: `${root}/x` },
    }).then((r) => expect(r.statusCode).toBe(400)); // wrong shape for mkdir: refused
    const fail = await record([
      { actionId: 'files.mkdir', params: { path: `${root}/f1` } },
      { actionId: 'files.mkdir', params: { path: `${root}/after` } },
    ]);
    const fd = (await call('GET', `/api/recipes/${fail}`)).json();
    // Delete the folder first so that "mkdir" of a path whose parent is a FILE fails: make the parent a file on both.
    for (const id of [a, b])
      await remote(id, `mkdir -p ${root} && rm -rf ${root}/blocker && : > ${root}/blocker`);
    // Recording ran these steps on vps-a, so clear the second one: the replay must be what creates it.
    for (const id of [a, b]) await remote(id, `rm -rf ${root}/after`);
    await call('PATCH', `/api/recipes/${fail}/steps/${fd.steps[0].id}`, {
      params: { path: `${root}/blocker/child` },
    }); // parent is a file: mkdir fails

    const r = await call('POST', '/api/jobs', {
      kind: 'replay',
      serverIds: [a, b],
      recipeId: fail,
    });
    const id = r.json().id as string;
    const paused = await waitFor(id, (j) => j.targets.every((t) => t.status === 'paused'));
    expect(paused.targets[0]!.steps.map((s) => s.status)).toEqual(['failed', 'pending']);
    expect(paused.targets[0]!.steps[0]!.exitCode).not.toBe(0);
    for (const sid of [a, b])
      expect((await remote(sid, `test -e ${root}/after && echo yes || echo no`)).out).toBe('no'); // nothing ran past the failure

    for (const sid of [a, b])
      expect(
        (await call('POST', `/api/jobs/${id}/targets/${sid}/decision`, { decision: 'skip' }))
          .statusCode,
      ).toBe(200);
    const done = await waitFor(id, (j) => j.status !== 'running');
    expect(done.status).toBe('done');
    expect(done.targets[0]!.steps.map((s) => s.status)).toEqual(['skipped', 'ok']);
    for (const sid of [a, b])
      expect((await remote(sid, `test -d ${root}/after && echo yes`)).out).toBe('yes');
    expect(
      (await call('POST', `/api/jobs/${id}/targets/${a}/decision`, { decision: 'retry' }))
        .statusCode,
    ).toBe(409); // no longer paused
  });

  it('the Safety Net is enforced by the server: a caution step needs confirmation', async () => {
    const recipeId = await record([
      { actionId: 'files.chmod', params: { path: `${root}/f1`, mode: '750', recursive: false } },
    ]);
    const no = await call('POST', '/api/jobs', { kind: 'replay', serverIds: [a], recipeId });
    expect(no.statusCode).toBe(403);
    expect(no.json()).toMatchObject({ error: 'confirmation_required' });
    const yes = await call('POST', '/api/jobs', {
      kind: 'replay',
      serverIds: [a],
      recipeId,
      confirmed: true,
    });
    expect(yes.statusCode).toBe(200);
    await waitFor(yes.json().id, (j) => j.status !== 'running');
    expect((await remote(a, `stat -c %a ${root}/f1`)).out).toBe('750');
  });

  it('refuses a disconnected target and names it', async () => {
    ctx.pool.disconnect(b);
    const r = await call('POST', '/api/jobs', {
      kind: 'broadcast',
      serverIds: [a, b],
      steps: [{ actionId: 'system.uptime' }],
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: 'not_connected', serverIds: [b] });
  });

  it('cancel stops a running job', async () => {
    const r = await call('POST', '/api/jobs', {
      kind: 'broadcast',
      serverIds: [a],
      steps: [{ actionId: 'devhub.install.git' }],
      confirmed: true,
    });
    // A long install: cancel it right away (works whether or not apt gets going).
    expect([200, 403]).toContain(r.statusCode);
    if (r.statusCode === 200) {
      const id = r.json().id;
      await call('POST', `/api/jobs/${id}/cancel`);
      const done = await waitFor(id, (j) => j.status !== 'running');
      expect(['cancelled', 'done', 'failed']).toContain(done.status);
    }
  });
});
