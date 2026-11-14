import { expect, type Page } from '@playwright/test';
import { openGfv } from './helpers';

/** Runs in the page: every visible text element whose contrast is below WCAG AA. */
export function auditContrast(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    /** Any CSS colour (rgb, oklab, color-mix...) -> [r,g,b,a]. The canvas does the parsing. */
    const rgba = (css: string): [number, number, number, number] => {
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = '#000';
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
    };
    const over = (top: number[], bottom: number[]) => {
      const a = top[3]!;
      return [0, 1, 2].map((i) => top[i]! * a + bottom[i]! * (1 - a)).concat([1]);
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const ratio = (a: number[], b: number[]) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };

    /** Effective background colour behind an element, or null if it is not a solid colour (gradients, images). */
    const backdrop = (el: Element): number[] | null => {
      const layers: number[][] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage !== 'none') return null;
        const c = rgba(cs.backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] === 1) break;
      }
      let acc: number[] = rgba(getComputedStyle(document.body).backgroundColor);
      if (acc[3] < 1) acc = [255, 255, 255, 1];
      for (const l of layers.reverse()) acc = over(l, acc);
      return acc;
    };
    const opacityChain = (el: Element) => {
      let o = 1;
      for (let e: Element | null = el; e; e = e.parentElement)
        o *= parseFloat(getComputedStyle(e).opacity);
      return o;
    };

    const bad: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.trim();
      const el = n.parentElement;
      if (!text || !el || seen.has(el)) continue;
      seen.add(el);
      if (
        el.closest(
          '.xterm, .monaco-editor, .uplot, script, style, noscript, [aria-hidden="true"], .sr-only',
        )
      )
        continue;
      if (el.closest(':disabled, [aria-disabled="true"], [data-disabled]')) continue; // disabled controls are exempt
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none')
        continue;
      if (opacityChain(el) < 0.99) continue; // fading / dimmed on purpose
      // SVG text (the Server Map): the colour is the `fill`, the background is the box (<rect>) drawn behind
      // the text in the same group, over whatever HTML surface the <svg> sits on. The size on screen is the
      // font size times the scale the viewBox applies.
      const svg = el instanceof SVGElement ? el.ownerSVGElement : null;
      let bg: number[] | null;
      let fgCss = cs.color;
      let scale = 1;
      if (svg && el instanceof SVGGraphicsElement) {
        fgCss = cs.fill;
        scale = el.getScreenCTM()?.a ?? 1;
        const base = svg.parentElement ? backdrop(svg.parentElement) : null;
        const rect = el.closest('g')?.querySelector(':scope > rect');
        if (!base) continue;
        bg = rect ? over(rgba(getComputedStyle(rect).fill), base) : base;
        const o = parseFloat(cs.fillOpacity);
        if (o < 1) fgCss = `color-mix(in srgb, ${cs.fill} ${o * 100}%, transparent)`;
      } else {
        bg = backdrop(el);
      }
      if (!bg) continue;
      const fg = over(rgba(fgCss), bg);
      const size = parseFloat(cs.fontSize) * scale;
      const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight) >= 700);
      const need = large ? 3 : 4.5;
      const got = ratio(fg, bg);
      if (got < need - 0.01) {
        bad.push(
          `${got.toFixed(2)} < ${need}  "${text.slice(0, 40)}"  <${el.tagName.toLowerCase()} class="${(el.getAttribute('class') ?? '').slice(0, 60)}">`,
        );
      }
      // Text that ends up tiny on screen is unreadable whatever its contrast.
      if (svg && size < 9.5)
        bad.push(`font is only ${size.toFixed(1)}px on screen  "${text.slice(0, 40)}"`);
    }
    return bad;
  });
}

/** Solid backgrounds (Reduce Transparency) in the given theme, so contrast is measured exactly. */
export const settle = (page: Page) => page.waitForTimeout(700);

export async function prepare(page: Page, theme: 'light' | 'dark') {
  await openGfv(page);
  await page.evaluate((t) => {
    localStorage.removeItem('gfv.desktop.v1');
    localStorage.setItem(
      'gfv.appearance.v1',
      JSON.stringify({ wallpaper: 'graphite', reduceTransparency: true }),
    );
    // Seed the theme the way the app persists it.
    localStorage.setItem('gfv.desktop.v1', JSON.stringify({ windows: [], nextZ: 1, theme: t }));
  }, theme);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
}
