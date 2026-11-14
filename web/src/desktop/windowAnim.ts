/**
 * Window open / close / minimize / restore animations.
 *
 * They use the Web Animations API on the window's visual frame (never on the react-rnd wrapper,
 * which owns the position transform). Durations and the spring come from the CSS tokens, so
 * `prefers-reduced-motion` (tokens collapse to 1ms) and the design stay in one place.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Scale a minimized window shrinks to on its way into the Dock. */
export const MINIMIZE_SCALE = 0.12;

/** How far (dx, dy) the window's centre must travel so it ends up at the centre of `target`. */
export function translateToward(from: Box, target: Box): { dx: number; dy: number } {
  return {
    dx: target.x + target.width / 2 - (from.x + from.width / 2),
    dy: target.y + target.height / 2 - (from.y + from.height / 2),
  };
}

/** Where a window goes when minimized: its Dock/taskbar button if there is one, else bottom centre. */
export function minimizeTarget(winId: string, appId: string): Box {
  const q = (sel: string) => document.querySelector<HTMLElement>(sel);
  const anchor = q(`[data-win-anchor="${winId}"]`) ?? q(`[data-tour="app-${appId}"]`);
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  return { x: window.innerWidth / 2 - 24, y: window.innerHeight - 48, width: 48, height: 48 };
}

/** "420ms" -> 420, ".42s" -> 420 (the production CSS minifier rewrites ms values as seconds). */
export function parseDuration(value: string): number | undefined {
  const m = value.trim().match(/^(-?\d*\.?\d+)(ms|s)$/);
  if (!m) return undefined;
  return m[2] === 's' ? parseFloat(m[1]!) * 1000 : parseFloat(m[1]!);
}

function cssMs(name: string, fallback: number): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return parseDuration(v) ?? fallback;
}
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Run keyframes and resolve when they finish (or immediately without animation support / with reduced motion). */
async function play(
  el: HTMLElement,
  tracks: { keyframes: Keyframe[]; duration: number; easing: string }[],
): Promise<void> {
  if (reduced() || typeof el.animate !== 'function') return;
  const anims = tracks.map((t) =>
    el.animate(t.keyframes, { duration: t.duration, easing: t.easing, fill: 'backwards' }),
  );
  await Promise.allSettled(anims.map((a) => a.finished));
}

export function animateOpen(el: HTMLElement): Promise<void> {
  const slow = cssMs('--dur-slow', 420);
  return play(el, [
    {
      keyframes: [{ transform: 'scale(0.92) translateY(10px)' }, { transform: 'none' }],
      duration: slow,
      easing: cssVar('--ease-spring', 'ease-out'),
    },
    {
      keyframes: [{ opacity: 0 }, { opacity: 1 }],
      duration: cssMs('--dur-fast', 120) + 60,
      easing: 'ease-out',
    },
  ]);
}

export function animateClose(el: HTMLElement): Promise<void> {
  const dur = cssMs('--dur-fast', 120) + 40;
  // fill:'forwards' keeps the window invisible until React removes it.
  if (reduced() || typeof el.animate !== 'function') return Promise.resolve();
  const a = el.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'scale(0.95)' },
    ],
    { duration: dur, easing: 'ease-in', fill: 'forwards' },
  );
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

/** Genie-lite: shrink and slide toward the Dock/taskbar button, fading out over the last stretch. */
export function animateMinimize(el: HTMLElement, target: Box): Promise<void> {
  if (reduced() || typeof el.animate !== 'function') return Promise.resolve();
  const r = el.getBoundingClientRect();
  const { dx, dy } = translateToward(
    { x: r.left, y: r.top, width: r.width, height: r.height },
    target,
  );
  const dur = cssMs('--dur-slow', 420);
  const move = el.animate(
    [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${MINIMIZE_SCALE})` }],
    { duration: dur, easing: cssVar('--ease-out', 'ease-in-out'), fill: 'forwards' },
  );
  // Opacity has its own (linear) timing, so the window is still visible while it shrinks.
  const fade = el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], {
    duration: dur,
    easing: 'linear',
    fill: 'forwards',
  });
  return Promise.allSettled([move.finished, fade.finished]).then(() => undefined);
}

/** The reverse of minimize: grow out of the Dock/taskbar button. */
export function animateRestore(el: HTMLElement, target: Box): Promise<void> {
  const r = el.getBoundingClientRect();
  const { dx, dy } = translateToward(
    { x: r.left, y: r.top, width: r.width, height: r.height },
    target,
  );
  return play(el, [
    {
      keyframes: [
        { transform: `translate(${dx}px, ${dy}px) scale(${MINIMIZE_SCALE})` },
        { transform: 'none' },
      ],
      duration: cssMs('--dur-slow', 420),
      // No spring here: scaling up from 12% would overshoot the final size by ~14%.
      easing: cssVar('--ease-out', 'ease-out'),
    },
    {
      keyframes: [{ opacity: 0 }, { opacity: 1 }],
      duration: cssMs('--dur-fast', 120) + 60,
      easing: 'ease-out',
    },
  ]);
}

/** Drop the fill:'forwards' effects left by minimize/close (before the window is shown again). */
export function clearAnimations(el: HTMLElement): void {
  for (const a of el.getAnimations?.() ?? []) a.cancel();
}
