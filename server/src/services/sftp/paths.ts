import { posix } from 'node:path';

/** Absolute POSIX path, normalized. Returns undefined for anything we refuse to touch. */
export function normalizePath(p: unknown): string | undefined {
  if (typeof p !== 'string' || p.length === 0 || p.length > 4096) return undefined;
  if (p.includes('\0') || !p.startsWith('/')) return undefined;
  return posix.normalize(p).replace(/(.)\/+$/, '$1');
}

/** Does saving to `path` need a snapshot first? (the file lives under a protected prefix) */
export function needsSnapshot(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (pre) => path === pre || path.startsWith(pre.endsWith('/') ? pre : `${pre}/`),
  );
}

/** Flat, readable name for a snapshot file: /etc/ssh/sshd_config -> etc__ssh__sshd_config */
export function snapshotName(path: string, when: number): string {
  const flat = path
    .replace(/^\/+/, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/\/+/g, '__');
  return `${new Date(when).toISOString().replace(/[:.]/g, '-')}__${flat.replace(/_{3,}/g, '__')}`;
}
