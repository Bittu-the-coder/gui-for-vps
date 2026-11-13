import { describe, expect, it } from 'vitest';
import { exportRecipe, recipeStepInfo } from './export.js';

const at = new Date('2026-11-12T10:00:00Z');
const steps = [
  { actionId: 'files.mkdir', params: { path: '/home/gfv/my app' } },
  { actionId: 'devhub.install.git', params: {} },
  { actionId: 'files.rename', params: { from: '/home/gfv/a', to: '/home/gfv/b' } },
  { actionId: 'files.chmod', params: { path: '/home/gfv/b', mode: '750' } },
  { actionId: 'files.delete-path', params: { path: '/tmp/old' } },
];

describe('exportRecipe', () => {
  const script = exportRecipe({ name: 'My stack', steps, recordedOn: 'vps-a', generatedAt: at });
  it('has a shebang, strict mode and a header', () => {
    expect(
      script.startsWith(
        '#!/usr/bin/env bash\n# Recipe: My stack\n# Exported from GFV on 2026-11-12, recorded on vps-a.',
      ),
    ).toBe(true);
    expect(script).toContain('\nset -euo pipefail\n');
  });
  it('defines $SUDO once, only because a step needs it', () => {
    expect(script.match(/^SUDO=""$/gm)).toHaveLength(1);
    expect(script).toContain('$SUDO env DEBIAN_FRONTEND=noninteractive apt-get');
    expect(script).not.toContain('sudo -n');
    const noSudo = exportRecipe({ name: 'x', steps: [steps[0]!], generatedAt: at });
    expect(noSudo).not.toContain('SUDO');
  });
  it('labels each step, with its explanation as a comment', () => {
    expect(script).toContain("echo '==> Step 1/5: Create a folder'");
    expect(script).toContain("echo '==> Step 2/5: Install Git'");
    expect(script).toMatch(/# Creates a new folder\./);
  });
  it('quotes paths and makes rename safe to run twice', () => {
    expect(script).toContain("mkdir -p -- '/home/gfv/my app'");
    expect(script).toContain(
      'if [ -e /home/gfv/a ] && [ ! -e /home/gfv/b ]; then mv -nT -- /home/gfv/a /home/gfv/b; else echo',
    );
  });
  it('marks risky steps and never includes snapshot commands', () => {
    expect(script).toMatch(/# ⚠ DANGER: Deleting is permanent/);
    expect(script).toMatch(/# ⚠ Caution: Wrong permissions/);
    expect(script).not.toContain('.gfv/snapshots');
  });
  it('skips unknown actions and invalid params instead of crashing', () => {
    const s = exportRecipe({
      name: 'x',
      steps: [
        { actionId: 'gone.action', params: {} },
        { actionId: 'files.mkdir', params: { path: 'relative' } },
      ],
      generatedAt: at,
    });
    expect(s).toContain('# Skipped: "gone.action" is not available');
    expect(s).toContain('# Skipped: "files.mkdir"');
  });
  it('an empty recipe is still a valid script', () => {
    expect(exportRecipe({ name: 'empty', steps: [], generatedAt: at })).toContain(
      '# (This recipe has no steps.)',
    );
  });
  it('cannot be broken out of through the name (newlines are flattened)', () => {
    const s = exportRecipe({ name: 'evil\nrm -rf /', steps: [], generatedAt: at });
    expect(s.split('\n').filter((l) => l.startsWith('rm'))).toEqual([]);
  });
  it('recipeStepInfo returns null for unknown actions', () => {
    expect(recipeStepInfo('nope', {})).toBeNull();
    expect(recipeStepInfo('files.chmod', { path: '/a', mode: '755' })?.commands).toEqual([
      'chmod 755 -- /a',
    ]);
  });
});
