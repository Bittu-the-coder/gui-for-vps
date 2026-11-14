import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISTRO_GUARD, DNF_GUARD, toolById } from '@gfv/shared';

const dir = mkdtempSync(join(tmpdir(), 'gfv-guard-'));
/** Run a guard in sh against a fake /etc/os-release. */
const run = (guard: string, osRelease: string) => {
  const f = join(dir, 'os-release');
  writeFileSync(f, osRelease);
  return spawnSync('sh', ['-c', guard.replace('/etc/os-release', f)], { encoding: 'utf8' });
};

describe('install distro guards (run in sh)', () => {
  it('the apt guard accepts Debian-family systems and refuses the rest', () => {
    expect(
      run(DISTRO_GUARD, 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04"\n').status,
    ).toBe(0);
    expect(run(DISTRO_GUARD, 'ID=linuxmint\nID_LIKE="ubuntu debian"\n').status).toBe(0);
    const bad = run(DISTRO_GUARD, 'ID=fedora\nPRETTY_NAME="Fedora 40"\n');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('Ubuntu, Debian, Fedora and RHEL-family');
  });
  it('the dnf guard accepts Fedora and the RHEL family and refuses Debian', () => {
    expect(run(DNF_GUARD, 'ID=fedora\nPRETTY_NAME="Fedora 40"\n').status).toBe(0);
    expect(
      run(DNF_GUARD, 'ID=rocky\nID_LIKE="rhel centos fedora"\nPRETTY_NAME="Rocky 9"\n').status,
    ).toBe(0);
    expect(run(DNF_GUARD, 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu"\n').status).toBe(1);
  });
});

describe('exported install steps (pkg: auto), run in sh', () => {
  it('are valid shell, and refuse an unknown system with a clear message', () => {
    const script = toolById('git')!.install({ sudo: '', pkg: 'auto' })[1]!;
    expect(spawnSync('sh', ['-n'], { input: script, encoding: 'utf8' }).status).toBe(0);
    // With neither apt-get nor dnf on PATH it must stop, not guess.
    const r = spawnSync('/bin/sh', ['-c', script], {
      env: { PATH: '/nonexistent' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('GFV can only install tools');
  });
});
