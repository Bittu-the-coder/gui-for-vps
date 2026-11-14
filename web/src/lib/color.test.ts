import { describe, expect, it } from 'vitest';
import { contrastRatio, readableOn } from './color';

describe('readableOn', () => {
  it('white on dark colours, near-black on light ones', () => {
    expect(readableOn('#1e3a8a')).toBe('#ffffff');
    expect(readableOn('#ffffff')).toBe('#1d1d1f');
    expect(readableOn('#fde047')).toBe('#1d1d1f');
  });
  it('the server colours we offer all get AA text (4.5:1)', () => {
    for (const c of ['#0ea5e9', '#22c55e', '#f59e0b', '#dc2626', '#9333ea', '#ec4899']) {
      expect(contrastRatio(readableOn(c), c), c).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('ignores malformed input without throwing', () => {
    expect(() => readableOn('not a colour')).not.toThrow();
  });
});
