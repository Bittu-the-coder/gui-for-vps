export const joinPath = (dir: string, name: string) =>
  dir === '/' ? `/${name}` : `${dir}/${name}`;

export const parentPath = (p: string) => {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
};

/** Names we accept for new folders / renames: one path segment. */
export function nameError(name: string): string | null {
  if (name === '.' || name === '..') return 'Pick a real name.';
  if (name.includes('/')) return 'A name cannot contain "/".';
  if (name.includes('\0')) return 'Invalid character.';
  return null;
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
