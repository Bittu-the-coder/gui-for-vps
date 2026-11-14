import { describe, expect, it } from 'vitest';
import { clampToViewport, nextActionable, type MenuItem } from './menuItems';

const noop = () => {};
const items: MenuItem[] = [
  { type: 'label', label: 'Section' },
  { label: 'A', onSelect: noop },
  { type: 'separator' },
  { label: 'B', onSelect: noop, disabled: true },
  { label: 'C', onSelect: noop },
];

describe('nextActionable', () => {
  it('skips labels, separators and disabled items', () => {
    expect(nextActionable(items, 1, 1)).toBe(4); // A -> C (separator and disabled B skipped)
    expect(nextActionable(items, 4, -1)).toBe(1);
  });
  it('wraps around', () => {
    expect(nextActionable(items, 4, 1)).toBe(1);
    expect(nextActionable(items, 1, -1)).toBe(4);
  });
  it('finds the first item when starting before the list', () => {
    expect(nextActionable(items, -1, 1)).toBe(1);
  });
  it('returns -1 when nothing can be selected', () => {
    expect(nextActionable([{ type: 'separator' }], 0, 1)).toBe(-1);
    expect(nextActionable([], 0, 1)).toBe(-1);
  });
});

describe('clampToViewport', () => {
  it('keeps a menu inside the screen', () => {
    expect(clampToViewport(1300, 800, 200, 300, 1400, 850)).toEqual({ x: 1192, y: 542 });
    expect(clampToViewport(-50, -50, 200, 300, 1400, 850)).toEqual({ x: 8, y: 8 });
  });
  it('leaves a menu that already fits', () => {
    expect(clampToViewport(100, 100, 200, 300, 1400, 850)).toEqual({ x: 100, y: 100 });
  });
});
