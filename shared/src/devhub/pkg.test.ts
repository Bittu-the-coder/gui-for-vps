import { describe, expect, it } from 'vitest';
import { pkgManagerFor } from './detect.js';
import { purgePostgresCommands, toolById } from './tools.js';

const ctx = (pkg?: 'apt' | 'dnf' | 'auto') => ({ sudo: 'sudo -n ', ...(pkg ? { pkg } : {}) });
const cmds = (
  id: string,
  pkg?: 'apt' | 'dnf' | 'auto',
  which: 'install' | 'uninstall' = 'install',
) => toolById(id)![which](ctx(pkg)).join('\n');

describe('pkgManagerFor', () => {
  it('maps distro families to their package manager', () => {
    for (const f of ['ubuntu debian', 'debian', 'linuxmint ubuntu debian'])
      expect(pkgManagerFor(f)).toBe('apt');
    for (const f of [
      'fedora',
      'rhel centos fedora',
      'rocky rhel centos fedora',
      'almalinux rhel centos fedora',
    ])
      expect(pkgManagerFor(f)).toBe('dnf');
    for (const f of ['alpine', 'arch', 'unknown', '']) expect(pkgManagerFor(f)).toBeNull();
  });
});

describe('Dev Hub commands per package manager', () => {
  it('apt is the default and is unchanged', () => {
    expect(cmds('git')).toContain('apt-get -y -q -o DPkg::Lock::Timeout=120 install git');
    expect(cmds('git')).not.toContain('dnf');
    expect(cmds('git', 'apt')).toBe(cmds('git'));
  });
  it('dnf installs the dnf packages with its own guard', () => {
    const c = cmds('python', 'dnf');
    expect(c).toContain('sudo -n dnf -y -q install python3 python3-pip');
    expect(c).not.toContain('apt-get');
    expect(c).toContain('*fedora*|*rhel*|*centos*');
  });
  it('dnf initialises PostgreSQL (Fedora/RHEL do not do it for you) and starts it', () => {
    const c = cmds('postgresql', 'dnf');
    expect(c).toContain('dnf -y -q install postgresql-server postgresql-contrib');
    expect(c).toContain('sudo -n postgresql-setup --initdb');
    expect(c).toContain('systemctl enable --now postgresql');
  });
  it('Docker is refused on dnf with an explanation instead of guessing a package', () => {
    const c = cmds('docker', 'dnf');
    expect(c).not.toContain('dnf -y -q install');
    expect(c).toContain('not in the standard Fedora/RHEL repositories');
  });
  it('uninstall uses the right manager and names', () => {
    expect(cmds('nginx', 'dnf', 'uninstall')).toContain('dnf -y -q remove nginx');
    expect(cmds('nginx', 'apt', 'uninstall')).toContain('remove nginx nginx-common');
    expect(purgePostgresCommands(ctx('dnf')).join('\n')).toContain('/var/lib/pgsql');
    expect(purgePostgresCommands(ctx()).join('\n')).toContain('/var/lib/postgresql');
  });
  it('auto (exported scripts) picks the manager when it RUNS, and both branches are the live commands', () => {
    const c = cmds('git', 'auto');
    expect(c).toContain('if command -v apt-get >/dev/null 2>&1; then');
    expect(c).toContain('elif command -v dnf >/dev/null 2>&1; then');
    expect(c).toContain('install git');
  });
});
