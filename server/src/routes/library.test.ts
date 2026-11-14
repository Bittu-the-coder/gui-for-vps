import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { testCtx } from '../testUtil.js';

// Sharing: export a recipe as a file, import files (including hostile ones), the bundled starter library.
const H = { 'x-gfv-token': 't' };

describe('recipe files and the bundled library', () => {
  const ctx = testCtx();
  let app: FastifyInstance;
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: H, payload });

  beforeAll(async () => {
    app = await buildApp('t', ctx);
    await app.ready();
    await call('POST', '/api/vault/create', { password: 'master-pass' });
  });
  afterAll(() => app.close());

  const file = (over: object = {}) => ({
    format: 1,
    name: 'Imported site',
    params: [{ name: 'site', label: 'Site', default: 'main' }],
    steps: [{ actionId: 'files.mkdir', params: { path: '/var/www/{{site}}' } }],
    ...over,
  });

  it('imports a valid file as a recipe with its steps and parameters', async () => {
    const r = await call('POST', '/api/recipes/import', { file: file() });
    expect(r.statusCode, r.body).toBe(200);
    const detail = (await call('GET', `/api/recipes/${r.json().recipeId}`)).json();
    expect(detail).toMatchObject({ name: 'Imported site', serverId: null });
    expect(detail.params).toEqual([{ name: 'site', label: 'Site', default: 'main' }]);
    expect(detail.steps).toHaveLength(1);
    expect(detail.steps[0].params).toEqual({ path: '/var/www/{{site}}' });
  });

  it('the server re-validates: it refuses what the browser might have let through', async () => {
    const cases: [string, object][] = [
      [
        'an action that does not exist',
        file({ params: [], steps: [{ actionId: 'rm.everything', params: {} }] }),
      ],
      [
        'invalid parameters',
        file({
          params: [],
          steps: [{ actionId: 'files.chmod', params: { path: '/x', mode: 'rwx' } }],
        }),
      ],
      [
        'an action that must not be shared',
        file({
          params: [],
          steps: [
            { actionId: 'files.write-root', params: { path: '/etc/x', tmp: '/tmp/gfv-save-ab' } },
          ],
        }),
      ],
      ['an undeclared placeholder', file({ params: [] })],
      ['the wrong format version', file({ format: 99 })],
      ['no steps', file({ steps: [] })],
    ];
    for (const [why, body] of cases) {
      const r = await call('POST', '/api/recipes/import', { file: body });
      expect(r.statusCode, why).toBe(400);
      expect(r.json().problems.length, why).toBeGreaterThan(0);
    }
    expect((await call('POST', '/api/recipes/import', { file: 'not json' })).statusCode).toBe(400);
    expect((await call('POST', '/api/recipes/import', {})).statusCode).toBe(400);
  });

  it('a recipe exports to a file and imports back as an equal recipe (round trip)', async () => {
    const id = (
      await call('POST', '/api/recipes/import', { file: file({ name: 'Round trip' }) })
    ).json().recipeId;
    const shared = (await call('GET', `/api/recipes/${id}/file`)).json();
    expect(shared).toMatchObject({ format: 1, name: 'Round trip' });
    const again = await call('POST', '/api/recipes/import', { file: shared });
    expect(again.statusCode).toBe(200);
    const a = (await call('GET', `/api/recipes/${id}`)).json();
    const b = (await call('GET', `/api/recipes/${again.json().recipeId}`)).json();
    expect(b.steps.map((s: { params: unknown }) => s.params)).toEqual(
      a.steps.map((s: { params: unknown }) => s.params),
    );
    expect(b.params).toEqual(a.params);
  });

  it('the shared file has no secret values: a secret parameter is declared, never valued', async () => {
    const id = (
      await call('POST', '/api/recipes/import', {
        file: file({
          params: [{ name: 'pw', label: 'Password', secret: true }],
          steps: [{ actionId: 'files.mkdir', params: { path: '/tmp/{{pw}}' } }],
        }),
      })
    ).json().recipeId;
    const shared = (await call('GET', `/api/recipes/${id}/file`)).json();
    expect(shared.params).toEqual([{ name: 'pw', label: 'Password', secret: true }]);
  });

  it('lists the bundled starter recipes with their commands and risk, and imports one', async () => {
    const list = (await call('GET', '/api/library')).json();
    expect(list.length).toBeGreaterThanOrEqual(4);
    const node = list.find((r: { id: string }) => r.id === 'node-dev-box');
    expect(node.steps.map((s: { actionId: string }) => s.actionId)).toEqual([
      'devhub.install.git',
      'devhub.install.node',
    ]);
    expect(node.risk).toBe('caution'); // installs software with admin rights
    expect(node.steps[0].commands.length).toBeGreaterThan(0);

    const r = await call('POST', '/api/library/node-dev-box/import');
    expect(r.statusCode).toBe(200);
    expect((await call('GET', `/api/recipes/${r.json().recipeId}`)).json().steps).toHaveLength(2);
    expect((await call('POST', '/api/library/nope/import')).statusCode).toBe(404);
  });

  it('is locked until the vault is unlocked', async () => {
    await call('POST', '/api/vault/lock');
    expect((await call('GET', '/api/library')).statusCode).toBe(423);
    expect((await call('POST', '/api/recipes/import', { file: file() })).statusCode).toBe(423);
  });
});
