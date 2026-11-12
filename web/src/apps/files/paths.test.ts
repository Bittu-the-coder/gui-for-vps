import { describe, expect, it } from 'vitest';
import { formatSize, joinPath, nameError, parentPath } from './paths';

describe('paths', () => {
  it('joins and finds parents, including the root', () => {
    expect(joinPath('/', 'etc')).toBe('/etc');
    expect(joinPath('/home/gfv', 'a.txt')).toBe('/home/gfv/a.txt');
    expect(parentPath('/home/gfv')).toBe('/home');
    expect(parentPath('/home')).toBe('/');
    expect(parentPath('/')).toBe('/');
  });
  it('validates names', () => {
    expect(nameError('ok.txt')).toBeNull();
    expect(nameError('a/b')).not.toBeNull();
    expect(nameError('..')).not.toBeNull();
  });
  it('formats sizes', () => {
    expect(formatSize(12)).toBe('12 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
