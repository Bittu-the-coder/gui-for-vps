/**
 * Dock magnification, as pure functions.
 *
 * Icons are scaled with CSS transforms only (never layout), so growing an icon cannot move the
 * thing under the pointer and cause flicker. `dockLayout` also returns a horizontal offset per icon
 * so neighbours are pushed apart instead of overlapping, anchored so the exact point under the
 * pointer stays under the pointer (clicks always land on the icon you see).
 */

export const DOCK = {
  /** Icon size at rest, px. */
  size: 48,
  /** Largest scale, reached when the pointer is exactly over an icon's centre. */
  maxScale: 1.65,
  /** Icons further than this (px) from the pointer are not magnified. */
  radius: 120,
} as const;

/** Scale for an icon whose centre is `distance` px from the pointer: cosine falloff from maxScale to 1. */
export function magnification(distance: number, radius = DOCK.radius, maxScale = DOCK.maxScale) {
  const d = Math.abs(distance);
  if (d >= radius) return 1;
  return 1 + (maxScale - 1) * (0.5 + 0.5 * Math.cos((Math.PI * d) / radius));
}

export interface DockLayout {
  scales: number[];
  /** Horizontal shift (px) to apply to each icon, in addition to its scale. */
  offsets: number[];
}

/** `centers` are the icons' resting centres (px, same coordinate space as `pointerX`). */
export function dockLayout(
  centers: number[],
  pointerX: number | null,
  size = DOCK.size,
  maxScale = DOCK.maxScale,
  radius = DOCK.radius,
): DockLayout {
  if (pointerX === null || centers.length === 0) {
    return { scales: centers.map(() => 1), offsets: centers.map(() => 0) };
  }
  const scales = centers.map((c) => magnification(pointerX - c, radius, maxScale));

  // Displacement of each centre if the row simply grew rightwards from its left edge.
  const raw: number[] = [];
  let grown = 0;
  centers.forEach((_c, i) => {
    raw.push(grown + ((scales[i]! - 1) * size) / 2);
    grown += (scales[i]! - 1) * size;
  });

  // Anchor: the point under the pointer inside the nearest icon must not move.
  let k = 0;
  centers.forEach((c, i) => {
    if (Math.abs(c - pointerX) < Math.abs(centers[k]! - pointerX)) k = i;
  });
  const d = pointerX - centers[k]!;
  const wantedShift = d * (1 - scales[k]!);
  const anchor = raw[k]! - wantedShift;

  return { scales, offsets: raw.map((r) => r - anchor) };
}
