import { describe, expect, it } from 'vitest';
import { previewAction } from './index.js';
import { snapshotFileName, SNAPSHOT_SAVED } from '../snapshots.js';

describe('snapshot steps in previews', () => {
  const ctx = { sudo: 'sudo -n ', runId: 'run123', home: '/home/gfv' };
  const save = previewAction(
    'files.write-root',
    { path: '/etc/ssh/sshd_config', tmp: '/tmp/gfv-save-abc12345' },
    ctx,
  );
  it('back up first, then write, then clean up, all visible as commands', () => {
    if (!save.ok) throw new Error('preview failed');
    const c = save.preview.commands;
    expect(c[0]).toContain('mkdir -p -m 700');
    expect(c[1]).toContain(
      'sudo -n cat -- /etc/ssh/sshd_config > "$HOME/.gfv/snapshots/run123__etc_ssh_sshd_config"',
    );
    expect(c[2]).toBe('sudo -n cp -- /tmp/gfv-save-abc12345 /etc/ssh/sshd_config');
    expect(c[3]).toBe('rm -f -- /tmp/gfv-save-abc12345');
    expect(save.preview.snapshots).toEqual([
      { path: '/etc/ssh/sshd_config', name: 'run123__etc_ssh_sshd_config' },
    ]);
    expect(save.preview.risk).toBe('caution');
  });
  it('flags critical config files in the reasons', () => {
    if (!save.ok) throw new Error('x');
    expect(save.preview.reasons.join(' ')).toMatch(/lock you out|break/i);
  });
  it('the success line the runner looks for is printed by the backup command', () => {
    expect(SNAPSHOT_SAVED.exec('Snapshot saved: run123__etc_x (42 bytes)')?.slice(1)).toEqual([
      'run123__etc_x',
      '42',
    ]);
    expect(snapshotFileName('r', '/a b/../c')).toBe('r__a_b_.._c');
  });
  it('accepts only GFV temp files and GFV snapshots', () => {
    expect(previewAction('files.write-root', { path: '/etc/x', tmp: '/etc/passwd' }).ok).toBe(
      false,
    );
    expect(
      previewAction('files.write-root', { path: '/etc/x', tmp: '/tmp/gfv-save-../../etc' }).ok,
    ).toBe(false);
    const good = { path: '/etc/x', snapshot: '/home/gfv/.gfv/snapshots/r__etc_x' };
    expect(previewAction('files.restore-snapshot', good, ctx).ok).toBe(true);
    for (const snapshot of [
      '/etc/shadow',
      '/home/gfv/.gfv/snapshots/../../.ssh/id_rsa',
      '/home/gfv/.gfv/snapshots/a/b',
      '/home/gfv/.gfv/snapshots/x y',
    ]) {
      expect(
        previewAction('files.restore-snapshot', { path: '/etc/x', snapshot }).ok,
        snapshot,
      ).toBe(false);
    }
  });
  it('restore backs up the current file first (so it can be undone)', () => {
    const r = previewAction(
      'files.restore-snapshot',
      { path: '/etc/x', snapshot: '/home/gfv/.gfv/snapshots/r__etc_x' },
      ctx,
    );
    if (!r.ok) throw new Error('x');
    expect(r.preview.commands.at(-1)).toBe(
      'sudo -n cp -- /home/gfv/.gfv/snapshots/r__etc_x /etc/x',
    );
    expect(r.preview.snapshots).toHaveLength(1);
  });
  it('actions without snapshotPaths get no backup steps', () => {
    const r = previewAction('system.uptime', {});
    if (!r.ok) throw new Error('x');
    expect(r.preview.snapshots).toEqual([]);
    expect(r.preview.commands).toEqual(['uptime']);
  });
});
