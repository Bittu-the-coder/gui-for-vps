import { describe, expect, it } from 'vitest';
import { needsSnapshot, normalizePath, snapshotName } from './paths.js';

describe('normalizePath', () => {
  it('accepts absolute paths and cleans them', () => {
    expect(normalizePath('/etc//ssh/../hosts')).toBe('/etc/hosts');
    expect(normalizePath('/var/log/')).toBe('/var/log');
    expect(normalizePath('/')).toBe('/');
  });
  it('rejects relative, empty, NUL and non-strings', () => {
    for (const bad of ['', 'etc/hosts', '~/x', '/a\0b', undefined, 5]) {
      expect(normalizePath(bad)).toBeUndefined();
    }
  });
  it('collapses traversal at the root', () => expect(normalizePath('/../../etc')).toBe('/etc'));
});

describe('needsSnapshot', () => {
  it('matches the prefix itself and anything below, not lookalikes', () => {
    expect(needsSnapshot('/etc/nginx/nginx.conf', ['/etc'])).toBe(true);
    expect(needsSnapshot('/etc', ['/etc'])).toBe(true);
    expect(needsSnapshot('/etcetera/x', ['/etc'])).toBe(false);
    expect(needsSnapshot('/home/gfv/a', ['/etc'])).toBe(false);
  });
});

describe('snapshotName', () => {
  it('is a single flat filename', () => {
    const n = snapshotName('/etc/ssh/sshd_config', Date.UTC(2026, 0, 2, 3, 4, 5));
    expect(n).toBe('2026-01-02T03-04-05-000Z__etc_ssh_sshd_config');
    expect(n).not.toContain('/');
  });
});
