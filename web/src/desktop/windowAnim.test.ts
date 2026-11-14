import { describe, expect, it } from 'vitest';
import { parseDuration, translateToward } from './windowAnim';

describe('translateToward', () => {
  it('moves the window centre onto the target centre', () => {
    const from = { x: 100, y: 100, width: 400, height: 300 }; // centre 300,250
    const target = { x: 700, y: 780, width: 48, height: 48 }; // centre 724,804
    expect(translateToward(from, target)).toEqual({ dx: 424, dy: 554 });
  });

  it('is zero when already centred on the target', () => {
    const box = { x: 10, y: 20, width: 30, height: 40 };
    expect(translateToward(box, box)).toEqual({ dx: 0, dy: 0 });
  });

  it('can move up and left', () => {
    const from = { x: 500, y: 500, width: 100, height: 100 };
    const target = { x: 0, y: 0, width: 20, height: 20 };
    expect(translateToward(from, target)).toEqual({ dx: -540, dy: -540 });
  });
});

describe('parseDuration', () => {
  it('reads milliseconds and seconds (the minifier turns 420ms into .42s)', () => {
    expect(parseDuration('420ms')).toBe(420);
    expect(parseDuration('.42s')).toBeCloseTo(420);
    expect(parseDuration(' 1ms ')).toBe(1);
    expect(parseDuration('0.12s')).toBeCloseTo(120);
  });
  it('returns undefined for anything else', () => {
    expect(parseDuration('')).toBeUndefined();
    expect(parseDuration('fast')).toBeUndefined();
    expect(parseDuration('12')).toBeUndefined();
  });
});
