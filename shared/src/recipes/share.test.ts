import { describe, expect, it } from 'vitest';
import { BUNDLED_RECIPES } from './library.js';
import { inspectRecipeFile, toRecipeFile, RECIPE_FILE_FORMAT } from './share.js';

const good = {
  format: RECIPE_FILE_FORMAT,
  name: 'Site',
  params: [{ name: 'site', label: 'Site', default: 'main' }],
  steps: [{ actionId: 'files.mkdir', params: { path: '/var/www/{{site}}' } }],
};

describe('inspectRecipeFile', () => {
  it('accepts a valid file (object or JSON text) and describes each step', () => {
    for (const input of [good, JSON.stringify(good)]) {
      const r = inspectRecipeFile(input);
      if (!r.ok) throw new Error(r.problems.join('; '));
      expect(r.risk).toBe('safe');
      expect(r.steps[0]!.title).toBe('Create a folder');
      expect(r.steps[0]!.commands.join(' ')).toContain('/var/www/{{site}}');
    }
  });
  it('rejects non-JSON, the wrong format version, and missing steps', () => {
    expect(inspectRecipeFile('not json')).toMatchObject({ ok: false });
    expect(inspectRecipeFile({ ...good, format: 2 })).toMatchObject({ ok: false });
    expect(inspectRecipeFile({ ...good, steps: [] })).toMatchObject({ ok: false });
  });
  it('rejects an action that does not exist, with a clear message', () => {
    const r = inspectRecipeFile({ ...good, steps: [{ actionId: 'rm.everything', params: {} }] });
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).toContain('does not exist');
  });
  it('rejects invalid parameters for a real action', () => {
    const r = inspectRecipeFile({
      ...good,
      params: [],
      steps: [{ actionId: 'files.chmod', params: { path: '/x', mode: 'rwx' } }],
    });
    expect(r.ok).toBe(false);
  });
  it('only allows what a recording could have produced: not unrecordable or secret-holding actions', () => {
    const r = inspectRecipeFile({
      ...good,
      params: [],
      steps: [
        { actionId: 'files.write-root', params: { path: '/etc/x', tmp: '/tmp/gfv-save-abc' } },
      ],
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain('cannot be part of a shared recipe');
  });
  it('flags an undeclared placeholder', () => {
    const r = inspectRecipeFile({ ...good, params: [] });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain('{{site}}');
  });
  it('reports the highest risk', () => {
    const r = inspectRecipeFile({
      ...good,
      params: [],
      steps: [
        { actionId: 'files.mkdir', params: { path: '/tmp/x' } },
        { actionId: 'devhub.install.git', params: {} },
      ],
    });
    expect(r).toMatchObject({ ok: true, risk: 'caution' });
  });
  it('unknown extra fields do not smuggle anything in', () => {
    const r = inspectRecipeFile({
      ...good,
      evil: 'x',
      steps: [{ actionId: 'files.mkdir', params: { path: '/tmp/x' }, run: 'rm -rf /' }],
      params: [],
    });
    if (!r.ok) throw new Error('should still be valid');
    expect(JSON.stringify(r.file)).not.toContain('rm -rf');
  });
});

describe('toRecipeFile', () => {
  it('round-trips through inspect', () => {
    const f = toRecipeFile(
      { name: 'Site', params: good.params, steps: good.steps },
      { description: 'd', tags: ['a'] },
    );
    expect(f).toMatchObject({ format: 1, name: 'Site', description: 'd', tags: ['a'] });
    expect(inspectRecipeFile(JSON.parse(JSON.stringify(f)))).toMatchObject({ ok: true });
  });
});

describe('bundled library', () => {
  it.each(BUNDLED_RECIPES.map((r) => [r.id, r] as const))('%s is a valid recipe file', (_id, r) => {
    const out = inspectRecipeFile({ ...r, id: undefined });
    if (!out.ok) throw new Error(out.problems.join('; '));
    expect(out.steps.length).toBeGreaterThan(0);
  });
  it('has unique ids', () => {
    expect(new Set(BUNDLED_RECIPES.map((r) => r.id)).size).toBe(BUNDLED_RECIPES.length);
  });
});
