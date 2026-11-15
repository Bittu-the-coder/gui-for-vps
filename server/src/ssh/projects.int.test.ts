import { readFileSync } from 'node:fs';
import { connect as tcp } from 'node:net';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it, vi, beforeAll } from 'vitest';
import { parseProjects, renderEnvFile } from '@gfv/shared';
import { buildApp } from '../app.js';
import { exclusive, testCtx } from '../testUtil.js';

// Projects on a REAL Ubuntu container (vps-b): real git against a real bare repository, real files and permissions.
// (No systemd: the shim answers systemctl, so enabling the service is canned; the unit FILE is real.)
const reachable = await new Promise<boolean>((ok) => {
  const s = tcp(2202, '127.0.0.1');
  s.setTimeout(1500, () => (s.destroy(), ok(false)));
  s.on('connect', () => (s.end(), ok(true)));
  s.on('error', () => ok(false));
});
const privateKey = readFileSync(resolve(__dirname, '../../../e2e/keys/id_test'), 'utf8');
const H = { 'x-gfv-token': 't' };
vi.setConfig({ testTimeout: 400_000, hookTimeout: 120_000 });

describe.skipIf(!reachable)('projects: deploy from git (vps-b)', () => {
  const ctx = testCtx();
  let release: () => void = () => {};
  // Files that install packages on this server take turns (concurrent apt/dnf runs fight over the package lock).
  beforeAll(async () => {
    release = await exclusive('vps-b');
  }, 1_800_000);
  let app: FastifyInstance;
  let id: string;
  const stamp = Date.now();
  const name = `proj-${stamp % 100000}`;
  const work = `/tmp/gfv-m18-${stamp}`;
  const repo = `${work}/app.git`;
  const D = `$HOME/gfv-projects/${name}`;
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
  const remote = (cmd: string) =>
    new Promise<{ code: number; out: string }>((res, rej) =>
      ctx.pool.getClient(id)!.exec(cmd, (e, st) => {
        if (e) return rej(e);
        let out = '';
        st.on('data', (d: Buffer) => (out += d));
        st.stderr.on('data', (d: Buffer) => (out += d));
        st.on('close', (code: number) => res({ code, out: out.trim() }));
      }),
    );
  const run = async (actionId: string, params: object) => {
    const r = await call('POST', '/api/runs', { serverId: id, actionId, params, confirmed: true });
    expect(r.statusCode, r.body).toBe(200);
    const rr = ctx.runner.get(r.json().runId)!;
    await rr.done;
    return rr;
  };
  const list = async () => {
    const r = await call('POST', '/api/runs/query', {
      serverId: id,
      actionId: 'projects.list',
      params: {},
    });
    return parseProjects(r.json().stdout as string);
  };
  const pushVersion = (v: string) =>
    remote(
      `cd ${work}/work && echo ${v} > version.txt && git add -A && git commit -qm ${v} && git push -q origin main`,
    );

  afterAll(async () => {
    if (id)
      await remote(
        `rm -rf ${work} ${D}; sudo rm -f /etc/systemd/system/gfv-${name}.service /tmp/gfv-env-*`,
      ).catch(() => {});
    ctx.pool.disconnectAll();
    await app?.close();
    release();
  });

  it('sets up: connect, install git for real, and make a bare repository with a build script', async () => {
    app = await buildApp('t', ctx);
    await app.ready();
    await call('POST', '/api/vault/create', { password: 'master-pass' });
    id = (
      await call('POST', '/api/servers', {
        name: 'vps-b',
        host: '127.0.0.1',
        port: 2202,
        username: 'gfv',
        authType: 'key',
        privateKey,
      })
    ).json().id;
    const first = (await call('POST', `/api/servers/${id}/connect`)).json();
    await call('POST', `/api/servers/${id}/trust-host-key`, { fingerprint: first.fingerprint });
    expect((await call('POST', `/api/servers/${id}/connect`)).json().status).toBe('connected');
    const g = await run('devhub.install.git', {});
    expect(g.exitCode, g.outputTail).toBe(0);
    const s = await remote(
      `mkdir -p ${work} && cd ${work} && git init -q --bare app.git && git clone -q app.git work 2>/dev/null && cd work && ` +
        `git config user.email t@t && git config user.name t && echo v1 > version.txt && ` +
        `printf '#!/bin/sh\\ncp version.txt built.txt\\n' > build.sh && git add -A && git commit -qm v1 && git branch -M main && git push -q origin main`,
    );
    expect(s.code, s.out).toBe(0);
  });

  it('deploys: clones, runs the build command in the project folder, saves the settings', async () => {
    const r = await run('projects.deploy', {
      name,
      repo,
      branch: 'main',
      build: 'sh build.sh',
      start: 'cat built.txt',
    });
    expect(r.exitCode, r.outputTail).toBe(0);
    expect((await remote(`cat ${D}/version.txt`)).out).toBe('v1');
    expect((await remote(`cat ${D}/built.txt`)).out).toBe('v1'); // the build ran INSIDE the project folder
    const projects = await list();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      name,
      repo,
      branch: 'main',
      build: 'sh build.sh',
      start: 'cat built.txt',
      hasEnv: false,
      hasUnit: false,
    });
    expect(projects[0]!.head).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('check for updates sees a new commit; redeploying moves to it and discards local edits', async () => {
    expect((await pushVersion('v2')).code).toBe(0);
    const f = await run('projects.fetch', { name });
    expect(f.exitCode, f.outputTail).toBe(0);
    expect(f.outputTail).toContain('v2'); // the commit message of what is new
    expect((await list())[0]!.behind).toBe(1);

    await remote(`echo local-edit > ${D}/version.txt`);
    const r = await run('projects.deploy', { name, repo, branch: 'main', build: 'sh build.sh' });
    expect(r.exitCode, r.outputTail).toBe(0);
    expect((await remote(`cat ${D}/version.txt`)).out).toBe('v2'); // the local edit is gone, the new commit is in
    expect((await remote(`cat ${D}/built.txt`)).out).toBe('v2');
    expect((await list())[0]!.behind).toBe(0);
  });

  it('environment variables go through a temp file: mode 600, and the secret is nowhere in history', async () => {
    const secret = 'sup3r-s3cret-v@lue';
    const env = renderEnvFile({ PORT: '4000', API_KEY: secret });
    if (!env.ok) throw new Error(env.error);
    const tmp = `/tmp/gfv-env-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;
    const up = await call(
      'PUT',
      `/api/servers/${id}/fs/file?path=${encodeURIComponent(tmp)}&create=1`,
      Buffer.from(env.text),
      'application/octet-stream',
    );
    expect(up.statusCode).toBe(200);
    const r = await run('projects.env.install', { name, tmp });
    expect(r.exitCode, r.outputTail).toBe(0);
    expect((await remote(`stat -c %a ${D}/.env`)).out).toBe('600');
    expect((await remote(`cat ${D}/.env`)).out).toContain(`API_KEY="${secret}"`);
    expect((await remote(`test -e ${tmp} && echo left || echo gone`)).out).toBe('gone');
    const history = JSON.stringify((await call('GET', '/api/history')).json());
    expect(history).not.toContain(secret);
    expect((await list())[0]!.hasEnv).toBe(true);
  });

  it('installs a service: a real unit file for this user, with a backup when it is changed', async () => {
    const r = await run('projects.service.install', { name, start: 'node server.js' });
    expect(r.exitCode, r.outputTail).toBe(0);
    const unit = (await remote(`cat /etc/systemd/system/gfv-${name}.service`)).out;
    expect(unit).toContain('User=gfv');
    expect(unit).toContain(`WorkingDirectory=/home/gfv/gfv-projects/${name}`);
    expect(unit).toContain(`EnvironmentFile=-/home/gfv/gfv-projects/${name}/.env`);
    expect(unit).toContain('ExecStart=/bin/bash -lc "node server.js"');
    const p = (await list())[0]!;
    expect(p).toMatchObject({ hasUnit: true, active: 'active' }); // 'active' is the shim's canned answer

    const again = await run('projects.service.install', { name, start: 'node other.js' });
    expect(again.exitCode, again.outputTail).toBe(0);
    expect(again.outputTail).toContain('Snapshot saved');
  });

  it('refuses a hostile repository address before touching anything', async () => {
    for (const repoBad of ['--upload-pack=touch /tmp/pwned', 'ext::sh -c touch% /tmp/pwned']) {
      const r = await call('POST', '/api/runs', {
        serverId: id,
        actionId: 'projects.deploy',
        params: { name, repo: repoBad },
        confirmed: true,
      });
      expect(r.statusCode).toBe(400);
    }
    expect((await remote('test -e /tmp/pwned && echo PWNED || echo safe')).out).toBe('safe');
  });

  it('a caution deploy needs confirmation, enforced by the server', async () => {
    const r = await call('POST', '/api/runs', {
      serverId: id,
      actionId: 'projects.deploy',
      params: { name, repo },
    });
    expect(r.statusCode).toBe(403);
  });

  it('removes the project: folder, unit and listing', async () => {
    const r = await run('projects.remove', { name });
    expect(r.exitCode, r.outputTail).toBe(0);
    expect((await remote(`test -e ${D} && echo left || echo gone`)).out).toBe('gone');
    expect(
      (await remote(`test -e /etc/systemd/system/gfv-${name}.service && echo left || echo gone`))
        .out,
    ).toBe('gone');
    expect(await list()).toEqual([]);
  });
});
