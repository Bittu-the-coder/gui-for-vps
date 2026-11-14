import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Accessibility guard: every text/background pair we rely on must meet WCAG AA (4.5:1) in BOTH
// themes. If someone edits a colour in tokens.css and breaks contrast, this fails.

const css = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const m = css.match(new RegExp(`^${selector.replace('.', '\\.')} \\{([\\s\\S]*?)^\\}`, 'm'));
  if (!m) throw new Error(`no ${selector} block in tokens.css`);
  const vars: Record<string, string> = {};
  for (const [, name, value] of m[1]!.matchAll(/--([\w-]+):\s*([^;]+);/g))
    vars[name!] = value!.trim();
  return vars;
}

const light = block(':root');
const dark = { ...light, ...block('.dark') }; // .dark only overrides what differs

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** [text token, background token] */
const PAIRS: [string, string][] = [
  ['foreground', 'background'],
  ['foreground', 'surface-sunken'],
  ['foreground', 'surface-chrome-solid'],
  ['foreground', 'surface-glass-solid'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'surface-sunken'],
  ['faint-foreground', 'background'],
  ['faint-foreground', 'muted'],
  ['faint-foreground', 'surface-sunken'],
  ['primary-foreground', 'primary'],
  ['destructive-foreground', 'destructive'],
  ['link', 'background'],
  ['danger', 'background'],
  ['success', 'background'],
  ['warning', 'background'],
  ['accent-foreground', 'accent'],
  ['secondary-foreground', 'secondary'],
  ['popover-foreground', 'popover'],
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme contrast (WCAG AA, 4.5:1)', (_name, vars) => {
  it.each(PAIRS)('%s on %s', (fg, bg) => {
    const f = vars[fg];
    const b = vars[bg];
    expect(f, `--${fg} missing`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(b, `--${bg} missing`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(f!, b!)).toBeGreaterThanOrEqual(4.5);
  });
});

it('focus ring is visible (3:1) against the window background in both themes', () => {
  expect(contrast(light.ring!, light.background!)).toBeGreaterThanOrEqual(3);
  expect(contrast(dark.ring!, dark.background!)).toBeGreaterThanOrEqual(3);
});
