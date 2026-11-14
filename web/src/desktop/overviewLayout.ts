/**
 * Mission Control layout: shrink every window into a grid that fits the workspace.
 * Pure geometry. For each window it returns how far to move its centre (dx, dy) and the scale to apply
 * (a CSS transform on the window's frame, so the real, live window is what you see, just smaller).
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Slot {
  id: string;
  dx: number;
  dy: number;
  scale: number;
  /** Where the scaled window ends up (for the label under it). */
  target: Rect;
}

export interface LayoutOptions {
  /** Space kept free around the grid. */
  pad?: number;
  gap?: number;
  /** Height reserved under each window for its title. */
  label?: number;
  /** Space kept free at the bottom (the Dock). */
  bottomSafe?: number;
}

export function overviewLayout(
  windows: { id: string; rect: Rect }[],
  area: { w: number; h: number },
  { pad = 40, gap = 28, label = 30, bottomSafe = 96 }: LayoutOptions = {},
): Slot[] {
  const n = windows.length;
  if (n === 0) return [];
  const usableW = area.w - 2 * pad;
  const usableH = area.h - pad - bottomSafe;
  // Columns: roughly matches the workspace's shape (wide screens get more columns).
  const cols = Math.min(
    n,
    Math.max(1, Math.round(Math.sqrt((n * usableW) / Math.max(usableH, 1)))),
  );
  const rows = Math.ceil(n / cols);
  const cellW = (usableW - (cols - 1) * gap) / cols;
  const cellH = (usableH - (rows - 1) * gap) / rows - label;

  return windows.map(({ id, rect }, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    // A shorter last row is centred instead of left-aligned.
    const inRow = row === rows - 1 ? n - cols * (rows - 1) : cols;
    const rowOffset = ((cols - inRow) * (cellW + gap)) / 2;
    const scale = Math.max(0.05, Math.min(cellW / rect.w, cellH / rect.h, 1));
    const cx = pad + rowOffset + col * (cellW + gap) + cellW / 2;
    const cy = pad + row * (cellH + label + gap) + cellH / 2;
    return {
      id,
      dx: cx - (rect.x + rect.w / 2),
      dy: cy - (rect.y + rect.h / 2),
      scale,
      target: {
        x: cx - (rect.w * scale) / 2,
        y: cy - (rect.h * scale) / 2,
        w: rect.w * scale,
        h: rect.h * scale,
      },
    };
  });
}
