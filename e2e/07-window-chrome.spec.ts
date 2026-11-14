import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openApp, openGfv, vpsUp } from './helpers';

// Window chrome: traffic lights, animated open / minimize / restore / maximize / close, and the
// active-window look. Animations run for real here (the browser is not in reduced-motion mode).

const wins = (page: import('@playwright/test').Page) => page.getByTestId('window');

/** Wait until the window's open/restore animation has finished (sizes measured mid-animation are scaled). */
const settled = (win: import('@playwright/test').Locator) =>
  expect.poll(() => win.evaluate((el) => el.getAnimations().length)).toBe(0);

test.beforeEach(async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  // Start every test from an empty desktop.
  await page.evaluate(() => localStorage.removeItem('gfv.desktop.v1'));
  await page.reload();
  await expect(wins(page)).toHaveCount(0);
});

test('minimize hides the window, its Dock icon restores it', async ({ page }) => {
  await openApp(page, 'files');
  const win = wins(page).first();
  await expect(win).toBeVisible();

  await win.getByRole('button', { name: 'Minimize' }).click();
  await expect(win).toBeHidden(); // after the animation, the window is display:none
  await page.locator('[data-win-anchor]').first().click(); // the minimized window's Dock item restores it
  await expect(win).toBeVisible();
  // The restore animation leaves nothing behind: the window is fully opaque and un-transformed.
  await expect
    .poll(() =>
      win.evaluate((el) => getComputedStyle(el).opacity + '|' + getComputedStyle(el).transform),
    )
    .toBe('1|none');
});

test('maximize fills the workspace, a second click restores the size', async ({ page }) => {
  await openApp(page, 'files');
  const win = wins(page).first();
  await settled(win);
  const box0 = (await win.boundingBox())!;
  await win.getByRole('button', { name: 'Maximize' }).click();
  await expect.poll(async () => (await win.boundingBox())!.width).toBeGreaterThan(box0.width + 200);
  await win.getByRole('button', { name: 'Maximize' }).click();
  await expect
    .poll(async () => Math.round((await win.boundingBox())!.width))
    .toBe(Math.round(box0.width));
});

test('close removes the window (after its animation)', async ({ page }) => {
  await openApp(page, 'files');
  await openApp(page, 'monitor');
  await expect(wins(page)).toHaveCount(2);
  await wins(page).last().getByRole('button', { name: 'Close' }).click();
  await expect(wins(page)).toHaveCount(1);
  await expect(wins(page).first()).toHaveAttribute('data-app', 'files');
});

test('only the front window looks active', async ({ page }) => {
  await openApp(page, 'files');
  await openApp(page, 'monitor');
  await expect(wins(page).nth(1)).toHaveAttribute('data-focused', 'true');
  await expect(wins(page).first()).toHaveAttribute('data-focused', 'false');
  await wins(page).first().locator('.win-titlebar').click();
  await expect(wins(page).first()).toHaveAttribute('data-focused', 'true');
});

test('the terminal still works after being maximized and restored', async ({ page }) => {
  await openApp(page, 'terminal');
  const win = wins(page).first();
  const term = page.locator('.xterm-rows');
  await expect(term).toContainText('gfv@', { timeout: 20_000 });
  await win.getByRole('button', { name: 'Maximize' }).click();
  await page.waitForTimeout(600);
  await win.getByRole('button', { name: 'Maximize' }).click();
  await page.waitForTimeout(600);
  await page.locator('.xterm').click();
  await page.keyboard.type('echo chrome-$((6*7))\n');
  await expect(term).toContainText('chrome-42');
});

test('with prefers-reduced-motion, windows still open and close (instantly)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page, 'files');
  const win = wins(page).first();
  await expect(win).toBeVisible();
  await win.getByRole('button', { name: 'Close' }).click();
  await expect(wins(page)).toHaveCount(0, { timeout: 1500 });
});

test('screenshots mid-animation', async ({ page }) => {
  test.skip(!process.env.CAPTURE_UI, 'only when capturing UI screenshots');
  const out = join(import.meta.dirname, '..', 'docs', 'redesign', process.env.CAPTURE_UI!);
  mkdirSync(out, { recursive: true });
  await openApp(page, 'files');
  await openApp(page, 'monitor');
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(out, 'chrome-active-inactive.png') });
  await wins(page).last().getByRole('button', { name: 'Minimize' }).click();
  await page.waitForTimeout(160);
  await page.screenshot({ path: join(out, 'chrome-minimizing.png') });
  await page.locator('[data-win-anchor]').first().click();
  await page.mouse.move(5, 300);
  const dockBox = (await page.locator('[data-tour="app-docker"]').boundingBox())!;
  await page.mouse.move(dockBox.x + dockBox.width / 2, dockBox.y + dockBox.height / 2, {
    steps: 6,
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, 'dock-hover.png') });
  await page.mouse.move(5, 300);
  await page.getByRole('button', { name: 'Window menu' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(out, 'menu-window.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'GFV menu' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(out, 'menu-gfv.png') });
});

test('zoom fills the whole workspace to the screen edge; the Dock tucks away and returns on hover', async ({
  page,
}) => {
  await openApp(page, 'files');
  const win = wins(page).first();
  await settled(win);
  await win.getByRole('button', { name: 'Maximize' }).click();
  const vp = page.viewportSize()!;
  // The window reaches the bottom of the screen (no gap for the Dock) and starts under the menu bar.
  await expect
    .poll(async () => Math.round((await win.boundingBox())!.y + (await win.boundingBox())!.height))
    .toBe(vp.height);
  const bar = (await page.locator('header').first().boundingBox())!;
  expect(Math.round((await win.boundingBox())!.y)).toBe(Math.round(bar.y + bar.height));
  // The Dock is tucked below the screen edge while the window is zoomed...
  const icon = page.locator('[data-tour="app-files"]');
  await expect.poll(async () => (await icon.boundingBox())!.y).toBeGreaterThan(vp.height - 4);
  // ...and slides back when the pointer touches the bottom edge.
  await page.mouse.move(vp.width / 2, vp.height - 1);
  await expect.poll(async () => (await icon.boundingBox())!.y).toBeLessThan(vp.height - 40);
  // Restoring the window brings the Dock back for good.
  await page.mouse.move(vp.width / 2, 300);
  await win.getByRole('button', { name: 'Maximize' }).click();
  await expect.poll(async () => (await icon.boundingBox())!.y).toBeLessThan(vp.height - 40);
});

test('the full screen button puts the whole GUI in browser full screen and back', async ({
  page,
}) => {
  const isFs = () => page.evaluate(() => !!document.fullscreenElement);
  await page.getByRole('button', { name: 'Enter full screen' }).click();
  await expect.poll(isFs).toBe(true);
  await expect(page.getByRole('button', { name: 'Exit full screen' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect.poll(isFs).toBe(false);
  // Also reachable from the View menu.
  await page.getByRole('button', { name: 'View menu' }).click();
  await page.getByRole('menuitem', { name: 'Enter Full Screen' }).click();
  await expect.poll(isFs).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
});
