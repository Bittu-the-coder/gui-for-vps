import { describe, expect, it } from 'vitest';
import { DOCK, dockLayout, magnification } from './dockMath';

const centers = Array.from({ length: 8 }, (_, i) => 30 + i * 56); // 48px icons, 8px gap

describe('magnification', () => {
  it('is the maximum right over the icon and 1 at or beyond the radius', () => {
    expect(magnification(0)).toBeCloseTo(DOCK.maxScale);
    expect(magnification(DOCK.radius)).toBe(1);
    expect(magnification(-500)).toBe(1);
  });
  it('falls off smoothly and symmetrically', () => {
    const near = magnification(30);
    const far = magnification(90);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(1);
    expect(magnification(-30)).toBeCloseTo(near);
  });
});

describe('dockLayout', () => {
  it('does nothing without a pointer', () => {
    const l = dockLayout(centers, null);
    expect(l.scales.every((s) => s === 1)).toBe(true);
    expect(l.offsets.every((o) => o === 0)).toBe(true);
  });

  it('pointer over an icon centre: that icon is biggest and does not move', () => {
    const l = dockLayout(centers, centers[3]!);
    expect(l.scales[3]).toBeCloseTo(DOCK.maxScale);
    expect(l.offsets[3]).toBeCloseTo(0);
    expect(l.scales[3]!).toBeGreaterThan(l.scales[2]!);
    expect(l.scales[2]).toBeCloseTo(l.scales[4]!); // symmetric neighbours
  });

  it('keeps the point under the pointer fixed, wherever it is (clicks hit the icon you see)', () => {
    for (const p of [30, 47, 100, 143, 200, 300, 421]) {
      const l = dockLayout(centers, p);
      let k = 0;
      centers.forEach((c, i) => {
        if (Math.abs(c - p) < Math.abs(centers[k]! - p)) k = i;
      });
      const pointOnIcon = centers[k]! + l.offsets[k]! + (p - centers[k]!) * l.scales[k]!;
      expect(pointOnIcon).toBeCloseTo(p);
    }
  });

  it('pushes neighbours apart: icons keep their order and never overlap', () => {
    const l = dockLayout(centers, 150);
    for (let i = 1; i < centers.length; i++) {
      const prevRight = centers[i - 1]! + l.offsets[i - 1]! + (DOCK.size * l.scales[i - 1]!) / 2;
      const left = centers[i]! + l.offsets[i]! - (DOCK.size * l.scales[i]!) / 2;
      expect(left).toBeGreaterThanOrEqual(prevRight - 1e-6);
    }
  });

  it('handles an empty dock', () => {
    expect(dockLayout([], 10)).toEqual({ scales: [], offsets: [] });
  });
});
