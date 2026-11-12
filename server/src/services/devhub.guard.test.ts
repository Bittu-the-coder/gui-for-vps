import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISTRO_GUARD } from '@gfv/shared';

describe('install distro guard', () => {
  it('the guard really refuses non-Debian systems (run it in sh)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gfv-guard-'));
    const run = (osRelease: string) => {
      const f = join(dir, 'os-release');
      writeFileSync(f, osRelease);
      return spawnSync('sh', ['-c', DISTRO_GUARD.replace('/etc/os-release', f)], {
        encoding: 'utf8',
      });
    };
    const ok = run('ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04"\n');
    expect(ok.status).toBe(0);
    const bad = run('ID=fedora\nPRETTY_NAME="Fedora 40"\n');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('Ubuntu or Debian');
    expect(run('ID=linuxmint\nID_LIKE="ubuntu debian"\n').status).toBe(0);
  });
});
