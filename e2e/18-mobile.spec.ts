import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { auditContrast, prepare, settle } from './a11y';
import { openGfv, vpsUp } from './helpers';

// M25: the compact (phone) layout. A 390x844 touch viewport; the desktop shell must give way to a
// launcher grid, full-screen windows, a bottom tab bar and a sheet for Learn Mode.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const SHOTS = process.env.SHOT_DIR;
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const home = (page: Page) =>
  page.getByTestId('tab-bar').getByRole('button', { name: 'Home', exact: true });
/** Open an app from the launcher grid (going Home first when a window is covering it). */
async function open(page: Page, id: string) {
  if (!(await page.getByTestId('mobile-home').isVisible())) {
    await page
      .getByRole('dialog', { name: 'Open windows' })
      .waitFor({ state: 'hidden', timeout: 500 })
      .catch(() => {});
    await home(page).tap();
  }
  await page.locator(`[data-tour="app-${id}"]`).tap();
}
const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('phone layout: launcher, full-screen windows, tab bar, no Dock', async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  await expect(page.getByTestId('mobile-home')).toBeVisible();
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await expect(page.locator('[data-tour="dock"], [aria-label="Dock"]')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Tour' })).toHaveCount(0);
  await shot(page, 'home');

  await open(page, 'files');
  const win = page
    .getByTestId('window')
    .filter({ has: page.getByRole('button', { name: 'Close' }) });
  await expect(win).toBeVisible();
  const box = (await win.boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.width).toBe(390); // fills the screen: no dragging, no resizing
  await expect(page.getByTestId('window-count')).toHaveText('1');
  await shot(page, 'files');

  // Home puts it away (it keeps running); the launcher shows again, and tapping the app brings it back.
  await home(page).tap();
  await expect(page.getByTestId('mobile-home')).toBeVisible();
  await expect(win).toBeHidden();
  await page.locator('[data-tour="app-files"]').tap();
  await expect(win).toBeVisible();
  await expect(page.getByTestId('window-count')).toHaveText('1'); // the same window, not a second one

  // The window list switches and closes.
  await open(page, 'monitor');
  await expect(page.getByTestId('window-count')).toHaveText('2');
  await page.getByRole('button', { name: 'Open windows' }).tap();
  await expect(page.getByRole('dialog', { name: 'Open windows' })).toBeVisible();
  await shot(page, 'window-list');
  await page
    .getByRole('dialog', { name: 'Open windows' })
    .getByRole('button', { name: /^Files/ })
    .tap();
  await expect(page.locator('[data-testid="window"][data-app="files"]')).toBeVisible();
  await expect(page.locator('[data-testid="window"][data-app="monitor"]')).toBeHidden();
  await page.getByRole('button', { name: 'Open windows' }).tap();
  await page.getByRole('button', { name: 'Close Monitor' }).tap();
  await expect(page.getByTestId('window-count')).toHaveText('1');
  expect(await noSideScroll(page)).toBe(true);
});

test('Learn Mode is a sheet that starts closed and toggles from the tab bar', async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  await expect(page.getByRole('complementary', { name: 'Learn Mode' })).toHaveCount(0);
  await page.getByTestId('tab-bar').getByRole('button', { name: 'Toggle Learn Mode' }).tap();
  const sheet = page.getByRole('complementary', { name: 'Learn Mode' });
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  expect(box.width).toBe(390);
  await shot(page, 'learn');
  await page.getByTestId('tab-bar').getByRole('button', { name: 'Toggle Learn Mode' }).tap();
  await expect(sheet).toHaveCount(0);
});

test('list + detail apps show one pane at a time, with a way back', async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  await open(page, 'recipes');
  await page.getByRole('button', { name: 'Library…' }).tap();
  const dialog = page.getByRole('dialog', { name: 'Recipe library' });
  const entry = dialog.getByTestId('library-entry').filter({ hasText: 'Python + PostgreSQL' });
  await entry.getByRole('button', { name: 'Add' }).tap();
  await expect(page.getByTestId('recipe-step')).toHaveCount(2);
  // The detail fills the screen: the list is not squeezed next to it.
  const step = (await page.getByTestId('recipe-step').first().boundingBox())!;
  expect(step.width).toBeGreaterThan(330);
  await shot(page, 'recipes-detail');
  await page.getByRole('button', { name: 'All recipes' }).tap();
  await expect(page.getByTestId('recipe-step')).toHaveCount(0);
  await expect(page.getByText('Python + PostgreSQL').first()).toBeVisible();
  await shot(page, 'recipes-list');
});

test('a server card keeps its name readable and its buttons inside the screen', async ({
  page,
}) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  await open(page, 'servers');
  const card = page.getByRole('listitem').filter({ hasText: 'vps-a' }).first();
  const name = (await card.getByText('vps-a', { exact: true }).first().boundingBox())!;
  for (const b of await card.getByRole('button').all()) {
    const r = (await b.boundingBox())!;
    expect(r.x + r.width).toBeLessThanOrEqual(390);
    // no button sits on top of the server's name
    const overlap =
      r.x < name.x + name.width &&
      r.x + r.width > name.x &&
      r.y < name.y + name.height &&
      r.y + r.height > name.y;
    expect(overlap).toBe(false);
  }
});

test('Spotlight, Control Center, the server menu and the run dialog fit the screen', async ({
  page,
}) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  const fits = async (loc: ReturnType<Page['locator']>, what: string) => {
    await page.waitForTimeout(500); // let the entrance animation finish
    const b = (await loc.boundingBox())!;
    expect(b.x, `${what} left edge`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${what} right edge`).toBeLessThanOrEqual(390.5);
    expect(b.y + b.height, `${what} bottom edge`).toBeLessThanOrEqual(844.5);
  };
  await page.getByTestId('tab-bar').getByRole('button', { name: 'Search' }).tap();
  const box = page.getByRole('combobox');
  await box.fill('uptime');
  await fits(page.getByRole('dialog').first(), 'Spotlight');
  await shot(page, 'spotlight');
  await page.getByRole('option').filter({ hasText: 'Run:' }).first().tap();
  await expect(page.getByText('What this does')).toBeVisible();
  await fits(page.getByRole('dialog').first(), 'run dialog');
  await shot(page, 'run-dialog');
  await page.getByRole('button', { name: 'Cancel' }).tap();
  await page.getByRole('button', { name: 'Control Center' }).tap();
  await fits(page.getByRole('dialog', { name: /Control Center/ }), 'Control Center');
  await shot(page, 'control-center');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Active server' }).tap();
  await fits(page.getByRole('menu').first(), 'server menu');
  await shot(page, 'server-menu');
});

test('Terminal: the key row sends Esc/Tab/arrows and Ctrl+C reaches the shell', async ({
  page,
}) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  await open(page, 'terminal');
  const term = page.locator('.xterm-rows');
  await expect(term).toContainText('gfv@', { timeout: 20_000 });
  const keys = page.getByTestId('terminal-keys');
  await expect(keys).toBeVisible();
  await shot(page, 'terminal');
  await page.locator('.xterm').tap();
  await page.keyboard.type('sleep 60\n');
  await page.waitForTimeout(500);
  await keys.getByRole('button', { name: 'Control' }).tap();
  await expect(keys.getByRole('button', { name: 'Control' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.type('c'); // Ctrl armed + c = ^C, which ends sleep
  await expect(keys.getByRole('button', { name: 'Control' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.keyboard.type('echo back-$((20+1))\n');
  await expect(term).toContainText('back-21', { timeout: 10_000 });
  // Arrow up recalls the previous command through the key row.
  await keys.getByRole('button', { name: 'Arrow up' }).tap();
  await expect(term).toContainText('echo back-$((20+1))');
});

test('every app fits a phone: no sideways page scroll, nothing wider than the screen', async ({
  page,
}) => {
  test.setTimeout(180_000);
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  const ids = await page
    .locator('[data-testid="mobile-home"] [data-tour]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-tour')!.replace('app-', '')));
  expect(ids.length).toBeGreaterThan(10);
  const wide: string[] = [];
  for (const id of ids) {
    await open(page, id);
    await page.waitForTimeout(900);
    await shot(page, `app-${id}`);
    const over = await page.evaluate(() => {
      const w = document.querySelector<HTMLElement>(
        '[data-testid="window"]:not([style*="display: none"])',
      );
      if (!w) return ['no window'];
      const out: string[] = [];
      w.querySelectorAll<HTMLElement>('*').forEach((el) => {
        if (el.closest('.xterm, .monaco-editor, .uplot, svg, [role="toolbar"]')) return;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        // Wider than the screen, unless it sits inside something that scrolls sideways on purpose.
        if (r.right > window.innerWidth + 1) {
          let p: HTMLElement | null = el.parentElement;
          while (p && p !== w) {
            const o = getComputedStyle(p).overflowX;
            if (o === 'auto' || o === 'scroll' || o === 'hidden') return;
            p = p.parentElement;
          }
          out.push(
            `<${el.tagName.toLowerCase()} class="${(el.getAttribute('class') ?? '').slice(0, 50)}"> right=${Math.round(r.right)}`,
          );
        }
      });
      return out.slice(0, 4);
    });
    if (over.length) wide.push(`${id}: ${over.join(' | ')}`);
    if (!(await noSideScroll(page))) wide.push(`${id}: the page scrolls sideways`);
  }
  expect(wide, wide.join('\n')).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
  test(`phone layout contrast (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
    await prepare(page, theme);
    const failures: string[] = [];
    const check = async (name: string) => {
      await settle(page);
      for (const f of await auditContrast(page)) failures.push(`[${theme}] ${name}: ${f}`);
    };
    // Home: labels sit on the wallpaper (not a solid colour), so the audit skips them; the bars are measured.
    await check('home');
    await open(page, 'files');
    await check('files');
    await page.getByRole('button', { name: 'Open windows' }).tap();
    await check('window list');
    await page.getByRole('button', { name: 'Open windows' }).tap();
    await page.getByTestId('tab-bar').getByRole('button', { name: 'Toggle Learn Mode' }).tap();
    await check('learn sheet');
    expect(failures, failures.join('\n')).toEqual([]);
  });
}
