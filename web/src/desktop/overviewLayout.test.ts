import { describe, expect, it } from 'vitest';
import { overviewLayout, type Rect } from './overviewLayout';

const area = { w: 1200, h: 800 };
const win = (id: string, w = 700, h = 480, x = 100, y = 60): { id: string; rect: Rect } => ({
  id,
  rect: { x, y, w, h },
});
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('overviewLayout', () => {
  it('returns nothing for no windows', () => {
    expect(overviewLayout([], area)).toEqual([]);
  });

  it('one window is centred horizontally and never enlarged', () => {
    const [s] = overviewLayout([win('a', 300, 200)], area);
    expect(s!.scale).toBe(1);
    expect(s!.target.x + s!.target.w / 2).toBeCloseTo(area.w / 2);
  });

  it('every window fits inside the workspace, keeps its shape, and none overlap', () => {
    for (const n of [2, 3, 4, 5, 7, 9]) {
      const slots = overviewLayout(
        Array.from({ length: n }, (_, i) => win(`w${i}`, 700 + (i % 3) * 60, 480)),
        area,
      );
      expect(slots).toHaveLength(n);
      for (const s of slots) {
        expect(s.scale).toBeGreaterThan(0);
        expect(s.scale).toBeLessThanOrEqual(1);
        expect(s.target.x).toBeGreaterThanOrEqual(0);
        expect(s.target.y).toBeGreaterThanOrEqual(0);
        expect(s.target.x + s.target.w).toBeLessThanOrEqual(area.w);
        expect(s.target.y + s.target.h).toBeLessThanOrEqual(area.h);
      }
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++)
          expect(overlaps(slots[i]!.target, slots[j]!.target), `n=${n}: ${i} vs ${j}`).toBe(false);
    }
  });

  it('dx/dy move the window centre onto its slot', () => {
    const w = win('a', 700, 480, 100, 60);
    const [s] = overviewLayout([w], area);
    const centre = { x: w.rect.x + w.rect.w / 2 + s!.dx, y: w.rect.y + w.rect.h / 2 + s!.dy };
    expect(centre.x).toBeCloseTo(s!.target.x + s!.target.w / 2);
    expect(centre.y).toBeCloseTo(s!.target.y + s!.target.h / 2);
  });

  it('more windows means smaller windows', () => {
    const one = overviewLayout([win('a')], area)[0]!.scale;
    const six = overviewLayout(
      Array.from({ length: 6 }, (_, i) => win(`w${i}`)),
      area,
    )[0]!.scale;
    expect(six).toBeLessThan(one);
  });

  it('keeps the Dock area free at the bottom', () => {
    const slots = overviewLayout(
      Array.from({ length: 4 }, (_, i) => win(`w${i}`)),
      area,
      {
        bottomSafe: 120,
      },
    );
    for (const s of slots) expect(s.target.y + s.target.h).toBeLessThanOrEqual(area.h - 120);
  });
});
