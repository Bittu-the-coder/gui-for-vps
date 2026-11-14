import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aptUpdate, DISTRO_GUARD, DNF_GUARD, toolById } from '@gfv/shared';

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

describe('apt update retries while the package lists are locked (run in sh with a fake apt-get)', () => {
  /** A fake apt-get that fails with the real lock message `failures` times, then succeeds. */
  const run = (failures: number) => {
    const d = mkdtempSync(join(tmpdir(), 'gfv-apt-'));
    const counter = join(d, 'count');
    writeFileSync(counter, '0');
    writeFileSync(
      join(d, 'apt-get'),
      `#!/bin/sh\nn=$(cat ${counter}); n=$((n+1)); echo $n > ${counter}\nif [ $n -le ${failures} ]; then echo "E: Could not get lock /var/lib/apt/lists/lock" >&2; exit 100; fi\necho updated\n`,
    );
    chmodSync(join(d, 'apt-get'), 0o755);
    // The real command waits 10 s between tries: make that instant for the test.
    const cmd = aptUpdate({ sudo: '' }).replace('sleep 10', 'sleep 0');
    const r = spawnSync('/bin/sh', ['-c', cmd], {
      env: { PATH: `${d}:/usr/bin:/bin` },
      encoding: 'utf8',
    });
    return { ...r, tries: Number(spawnSync('cat', [counter], { encoding: 'utf8' }).stdout) };
  };
  it('keeps trying, says why it waits, and succeeds once the lock is free', () => {
    const r = run(2);
    expect(r.status).toBe(0);
    expect(r.tries).toBe(3);
    expect(r.stderr).toContain('The package system is busy');
    expect(r.stdout).toContain('updated');
  });
  it('gives up after 12 tries instead of waiting forever', () => {
    const r = run(1000);
    expect(r.status).toBe(1);
    expect(r.tries).toBe(12);
  });
  it('does not retry when it works the first time', () => {
    const r = run(0);
    expect(r.tries).toBe(1);
    expect(r.stderr).not.toContain('busy');
  });
});
