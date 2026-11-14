import { expect, test } from '@playwright/test';
import { openApp, openGfv, vpsUp } from './helpers';

// Menu bar, Dock and menus: mouse AND keyboard, plus the appearance settings they control.

const wins = (page: import('@playwright/test').Page) => page.getByTestId('window');

test.beforeEach(async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  await page.evaluate(() => {
    localStorage.removeItem('gfv.desktop.v1');
    localStorage.removeItem('gfv.appearance.v1');
  });
  await page.reload();
  await expect(wins(page)).toHaveCount(0);
});

test('File > New Terminal Window opens a terminal; the Window menu lists it', async ({ page }) => {
  await page.getByRole('button', { name: 'File menu' }).click();
  await page.getByRole('menuitem', { name: 'New Terminal Window' }).click();
  await expect(wins(page)).toHaveCount(1);
  await expect(wins(page).first()).toHaveAttribute('data-app', 'terminal');
  await page.getByRole('button', { name: 'Window menu' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Terminal' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('the menu bar works from the keyboard', async ({ page }) => {
  const gfv = page.getByRole('button', { name: 'GFV menu' });
  await gfv.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'GFV menu' });
  await expect(menu).toBeVisible();
  // The first enabled item has focus; arrows move; Right switches to the next menu; Escape closes.
  await expect(page.getByRole('menuitemcheckbox', { name: 'Light' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemcheckbox', { name: 'Dark' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menu', { name: 'File menu' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'File menu' })).toBeFocused();
});

test('keyboard: choosing Dark from the GFV menu switches the theme', async ({ page }) => {
  await page.getByRole('button', { name: 'GFV menu' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'GFV menu' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Light' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('wallpaper and reduce-transparency are applied and remembered across a reload', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'GFV menu' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Dusk' }).click();
  await expect(page.locator('[data-wallpaper]')).toHaveAttribute('data-wallpaper', 'dusk');
  await page.getByRole('button', { name: 'GFV menu' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Reduce Transparency' }).click();
  await expect(page.locator('html')).toHaveClass(/reduce-transparency/);
  // With transparency reduced the menu bar is solid, not glass.
  const bg = await page
    .locator('header')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toMatch(/rgba|\/ 0\./);
  await page.reload();
  await expect(page.locator('[data-wallpaper]')).toHaveAttribute('data-wallpaper', 'dusk');
  await expect(page.locator('html')).toHaveClass(/reduce-transparency/);
});

test('Dock: arrow keys move between icons, Enter opens, a running app gets a dot', async ({
  page,
}) => {
  const items = page.locator('[data-dock-item]');
  await items.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(items.nth(1)).toBeFocused(); // Terminal
  await page.keyboard.press('Enter');
  await expect(wins(page)).toHaveCount(1);
  await expect(wins(page).first()).toHaveAttribute('data-app', 'terminal');
  // The running-app dot is the visible span after the button (aria-hidden, so check by class).
  const dot = items
    .nth(1)
    .locator('xpath=following-sibling::span[contains(@class,"rounded-full")]');
  await expect(dot).not.toHaveClass(/invisible/);
});

test('Dock: right-click lists the app windows; New Window opens a second one', async ({ page }) => {
  await openApp(page, 'files');
  await expect(wins(page)).toHaveCount(1);
  await page.mouse.move(5, 300);
  await page.locator('[data-tour="app-files"]').click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Files options' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'New Window' }).click();
  await expect(wins(page)).toHaveCount(2);
});

test('clicking a running app in the Dock focuses it instead of opening another', async ({
  page,
}) => {
  await openApp(page, 'files');
  await openApp(page, 'monitor');
  await openApp(page, 'files'); // Files is already open: brought to the front
  await expect(wins(page)).toHaveCount(2);
  await expect(wins(page).filter({ has: page.locator('[data-app="files"]') })).toHaveCount(0);
  await expect(page.locator('[data-testid="window"][data-app="files"]')).toHaveAttribute(
    'data-focused',
    'true',
  );
});

test('the desktop context menu opens only on the bare desktop', async ({ page }) => {
  await page.mouse.click(300, 400, { button: 'right' });
  await expect(page.getByRole('menu', { name: 'Desktop' })).toBeVisible();
  await page.keyboard.press('Escape');
  await openApp(page, 'files');
  await wins(page).first().locator('.win-titlebar').click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Desktop' })).toHaveCount(0);
});
