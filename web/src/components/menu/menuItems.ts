import type { ReactNode } from 'react';

export type MenuItem =
  | {
      type?: 'item';
      label: string;
      onSelect: () => void;
      icon?: ReactNode;
      shortcut?: string;
      disabled?: boolean;
      /** Defined = a checkable item (shows a tick when true). */
      checked?: boolean;
      danger?: boolean;
    }
  | { type: 'separator' }
  | { type: 'label'; label: string };

export const isActionable = (i: MenuItem): i is Extract<MenuItem, { onSelect: () => void }> =>
  i.type !== 'separator' && i.type !== 'label' && !('disabled' in i && i.disabled);

/** Index of the next enabled item in `dir` (wraps around). -1 if there is none. */
export function nextActionable(items: MenuItem[], from: number, dir: 1 | -1): number {
  const n = items.length;
  for (let step = 1; step <= n; step++) {
    const i = (((from + dir * step) % n) + n) % n;
    if (isActionable(items[i]!)) return i;
  }
  return -1;
}

/** Clamp a menu of size (w, h) placed at (x, y) so it stays inside the viewport. */
export function clampToViewport(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
  margin = 8,
): { x: number; y: number } {
  return {
    x: Math.max(margin, Math.min(x, vw - w - margin)),
    y: Math.max(margin, Math.min(y, vh - h - margin)),
  };
}
