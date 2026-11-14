import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportRecipe } from '@gfv/shared';
import { describe, expect, it } from 'vitest';

// Exported scripts are RUN here (in real bash), not just compared as text: this is what proves that a
// parameter value can never turn into shell syntax.
const at = new Date('2026-11-12T10:00:00Z');
const params = [
  { name: 'site', label: 'Site name', default: 'main' },
  { name: 'token', label: 'API token', secret: true },
];
const mk = (dir: string) => [
  { actionId: 'files.mkdir', params: { path: `${dir}/site-{{site}}` } },
  { actionId: 'files.mkdir', params: { path: `${dir}/token-{{token}}` } },
];
const run = (script: string, env: Record<string, string>, cwd?: string) =>
  spawnSync('bash', ['-c', script], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    cwd,
  });
const inTemp = (fn: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'gfv-export-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('exported recipe scripts with parameters, run in bash', () => {
  it('are valid bash; values are filled in; a missing required one stops before doing anything', () =>
    inTemp((dir) => {
      const script = exportRecipe({ name: 'p', steps: mk(dir), params, generatedAt: at });
      expect(spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' }).status).toBe(0);

      const missing = run(script, {});
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain('Set GFV_TOKEN');
      expect(readdirSync(dir)).toEqual([]);

      const ok = run(script, { GFV_TOKEN: 'abc' });
      expect(ok.status, ok.stderr).toBe(0);
      expect(readdirSync(dir).sort()).toEqual(['site-main', 'token-abc']); // the default was used

      const given = run(script, { GFV_TOKEN: 't2', GFV_SITE: 'blue' });
      expect(given.status, given.stderr).toBe(0);
      expect(existsSync(join(dir, 'site-blue'))).toBe(true);
    }));

  it('treat a hostile value as plain text: no injected commands, no splitting into several arguments', () =>
    inTemp((dir) => {
      const script = exportRecipe({ name: 'p', steps: mk(dir), params, generatedAt: at });
      // No slashes, so it is one file name. If it were parsed as shell, `touch PWNED` would run in the
      // script's working directory (this folder) and leave a file behind.
      const evil = "x'; touch PWNED; echo '";
      const r = run(script, { GFV_TOKEN: evil, GFV_SITE: 'a b  c' }, dir);
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(join(dir, 'PWNED'))).toBe(false);
      expect(readdirSync(dir).sort()).toEqual(['site-a b  c', `token-${evil}`].sort());
    }));
});
