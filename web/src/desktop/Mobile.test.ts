import { describe, expect, it } from 'vitest';
import { topWindowId } from './Mobile';
import type { WindowState } from './windowStore';

const win = (id: string, z: number, minimized = false): WindowState => ({
  id,
  appId: 'files',
  title: id,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  z,
  minimized,
  maximized: false,
});
const byId = (...ws: WindowState[]) => Object.fromEntries(ws.map((w) => [w.id, w]));

describe('topWindowId (the one window shown on a phone)', () => {
  it('is the highest window that is not minimized', () => {
    expect(topWindowId(byId(win('a', 1), win('b', 5), win('c', 3)))).toBe('b');
    expect(topWindowId(byId(win('a', 1), win('b', 5, true), win('c', 3)))).toBe('c');
  });
  it('is null when everything is put away or nothing is open (the Home grid shows)', () => {
    expect(topWindowId(byId(win('a', 1, true), win('b', 2, true)))).toBeNull();
    expect(topWindowId({})).toBeNull();
  });
});
