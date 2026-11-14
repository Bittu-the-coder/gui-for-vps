import { expect, test, type Page } from '@playwright/test';
import { openApp, openGfv, vpsUp } from './helpers';

// Accessibility audit, measured on the rendered UI (not guessed from the tokens):
//  - text contrast (WCAG AA) on every screen, in both themes. Reduce Transparency is switched on while
//    measuring, so backgrounds are solid and the ratio is exact (glass would blend with the wallpaper);
//  - every control has an accessible name;
//  - keyboard focus is visible;
//  - prefers-reduced-motion really stops the animations.

/** Runs in the page: every visible text element whose contrast is below WCAG AA. */
function auditContrast(page: Page) {
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
      const bg = backdrop(el);
      if (!bg) continue;
      const fg = over(rgba(cs.color), bg);
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight) >= 700);
      const need = large ? 3 : 4.5;
      const got = ratio(fg, bg);
      if (got < need - 0.01) {
        bad.push(
          `${got.toFixed(2)} < ${need}  "${text.slice(0, 40)}"  <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}">`,
        );
      }
    }
    return bad;
  });
}

const settle = (page: Page) => page.waitForTimeout(700);

async function prepare(page: Page, theme: 'light' | 'dark') {
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

for (const theme of ['light', 'dark'] as const) {
  test(`text contrast meets WCAG AA on every screen (${theme})`, async ({ page }) => {
    test.setTimeout(240_000);
    test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
    await prepare(page, theme);
    const failures: string[] = [];
    const check = async (name: string) => {
      await settle(page);
      for (const f of await auditContrast(page)) failures.push(`[${theme}] ${name}: ${f}`);
    };

    await check('desktop + Learn panel');
    for (const id of [
      'servers',
      'files',
      'devhub',
      'monitor',
      'services',
      'docker',
      'snapshots',
      'recipes',
      'jobs',
      'lessons',
      'network',
    ]) {
      await openApp(page, id);
      await check(id);
      await page.getByTestId('window').last().getByRole('button', { name: 'Close' }).click();
      await expect(page.getByTestId('window')).toHaveCount(0);
    }
    // The run dialog (preview) and Spotlight, Control Center and a menu.
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('uptime');
    await check('spotlight');
    await page.getByRole('option').filter({ hasText: 'Run:' }).first().click();
    await expect(page.getByText('What this does')).toBeVisible();
    await check('run dialog');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Control Center' }).click();
    await check('control center');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'File menu' }).click();
    await check('menu');
    await page.keyboard.press('Escape');

    expect(failures, failures.join('\n')).toEqual([]);
  });
}

test('every visible control has an accessible name', async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await prepare(page, 'light');
  for (const id of [
    'servers',
    'files',
    'devhub',
    'monitor',
    'services',
    'docker',
    'snapshots',
    'recipes',
    'terminal',
  ])
    await openApp(page, id);
  await settle(page);
  const unnamed = await page.evaluate(() => {
    const name = (el: Element): string => {
      const h = el as HTMLElement;
      const labelled = el.getAttribute('aria-labelledby');
      if (labelled)
        return labelled
          .split(' ')
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
      return (
        el.getAttribute('aria-label') ||
        (h as HTMLInputElement).labels?.[0]?.textContent ||
        h.innerText?.trim() ||
        el.getAttribute('title') ||
        el.getAttribute('placeholder') ||
        (el.querySelector('img[alt]') as HTMLImageElement | null)?.alt ||
        ''
      ).trim();
    };
    const out: string[] = [];
    document
      .querySelectorAll(
        'button, [role="button"], a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="menuitem"], [role="option"]',
      )
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden') return;
        if ((el as HTMLElement).closest('.xterm, .monaco-editor, [hidden]')) return;
        if (!name(el))
          out.push(`<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 70)}">`);
      });
    return out;
  });
  expect(unnamed, unnamed.join('\n')).toEqual([]);
});

test('keyboard focus is always visible while tabbing through the desktop', async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await prepare(page, 'light');
  await openApp(page, 'files');
  await page.mouse.click(300, 700);
  const lost: string[] = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      const ring = cs.boxShadow !== 'none';
      const hl = !!el.closest('[role="option"], [role="menuitem"]');
      return {
        ok: outline || ring || hl,
        label: `${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? el.innerText?.slice(0, 20) ?? ''}`,
      };
    });
    if (r && !r.ok) lost.push(r.label);
  }
  expect(lost, `focused but nothing visible: ${lost.join(', ')}`).toEqual([]);
});

test('prefers-reduced-motion: windows appear instantly and the Dock does not magnify', async ({
  page,
}) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page, 'light');
  await openApp(page, 'files');
  await page.waitForTimeout(100);
  const running = await page
    .getByTestId('window')
    .first()
    .evaluate((el) => el.getAnimations().length);
  expect(running).toBe(0);
  // Hover an icon: with reduced motion its scale must stay 1.
  const icon = page.locator('[data-tour="app-docker"]');
  const box = (await icon.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.waitForTimeout(250);
  const t = await icon.evaluate((el) => getComputedStyle(el).transform);
  expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(t);
});

test('Reduce Transparency makes the glass surfaces solid', async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await prepare(page, 'dark');
  const solid = await page
    .locator('header')
    .first()
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return { alpha: cs.backgroundColor, blur: cs.backdropFilter };
    });
  expect(solid.blur === 'none' || solid.blur === '').toBe(true);
  expect(solid.alpha).not.toMatch(/\/ 0\.|rgba\(.*0\.\d+\)/);
});
