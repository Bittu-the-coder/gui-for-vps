import { expect, test, type Page } from '@playwright/test';
import { gotoPath, openApp, openGfv, vpsUp } from './helpers';

// Spotlight, Mission Control, Control Center, toasts, and the per-app menus.

const wins = (page: Page) => page.getByTestId('window');
const spotlight = (page: Page) => page.getByRole('dialog', { name: 'Spotlight' });

test.beforeEach(async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await openGfv(page);
  await page.evaluate(() => {
    localStorage.removeItem('gfv.desktop.v1');
    localStorage.removeItem('gfv.appearance.v1');
  });
  await page.reload();
  await expect(wins(page)).toHaveCount(0);
});

test.describe('Spotlight', () => {
  test('Ctrl+K opens it; typing finds an app; Enter opens it; Escape closes', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(spotlight(page)).toBeVisible();
    const box = page.getByRole('combobox', { name: /Search apps/ });
    await expect(box).toBeFocused();
    await box.fill('mon');
    await expect(page.getByRole('option').first()).toContainText('Monitor');
    await page.keyboard.press('Enter');
    await expect(spotlight(page)).toBeHidden();
    await expect(wins(page)).toHaveCount(1);
    await expect(wins(page).first()).toHaveAttribute('data-app', 'monitor');

    await page.keyboard.press('Control+k');
    await expect(spotlight(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(spotlight(page)).toBeHidden();
  });

  test('arrow keys move the selection; commands change settings', async ({ page }) => {
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('combobox').fill('dark');
    await expect(page.getByRole('option').first()).toContainText('Switch to Dark Mode');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('says so when nothing matches', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('qzxjv');
    await expect(spotlight(page)).toContainText('Nothing matches');
  });

  test('a runner action with no input opens its preview on the active server', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('uptime');
    await page.getByRole('option').filter({ hasText: 'Run:' }).first().click();
    await expect(page.getByText('What this does')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Ctrl+K inside the Terminal stays with the shell; Cmd+K still opens Spotlight', async ({
    page,
  }) => {
    await openApp(page, 'terminal');
    await expect(page.locator('.xterm-rows')).toContainText('gfv@', { timeout: 20_000 });
    await page.locator('.xterm').click();
    await page.keyboard.press('Control+k');
    await expect(spotlight(page)).toBeHidden();
    await page.keyboard.press('Meta+k');
    await expect(spotlight(page)).toBeVisible();
  });
});

test.describe('Mission Control', () => {
  test('shrinks the windows into a grid; clicking one brings it forward and leaves', async ({
    page,
  }) => {
    for (const id of ['files', 'monitor', 'devhub']) await openApp(page, id);
    await expect(wins(page)).toHaveCount(3);
    await page.mouse.click(300, 600); // focus lands on the desktop, not in a text field
    await page.keyboard.press('Control+ArrowUp');
    await expect(page.locator('[data-overview="true"]')).toHaveCount(3);
    // The real windows are scaled down (a transform), not replaced by pictures.
    const t = await wins(page)
      .first()
      .evaluate((el) => getComputedStyle(el).transform);
    expect(t).not.toBe('none');
    // Choose the Files window.
    await page.getByRole('button', { name: 'Show Files' }).click();
    await expect(page.locator('[data-overview="true"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="window"][data-app="files"]')).toHaveAttribute(
      'data-focused',
      'true',
    );
  });

  test('Escape leaves it, and an empty desktop says so', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('mission');
    await page.keyboard.press('Enter');
    await expect(page.getByText('No open windows')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('No open windows')).toBeHidden();
  });
});

test.describe('Control Center', () => {
  test('theme, wallpaper and Learn Mode from one panel', async ({ page }) => {
    await page.getByRole('button', { name: 'Control Center' }).click();
    const cc = page.getByRole('dialog', { name: 'Control Center' });
    await expect(cc).toBeVisible();
    await cc.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await cc.getByRole('button', { name: 'Wallpaper Meadow' }).click();
    await expect(page.locator('[data-wallpaper]')).toHaveAttribute('data-wallpaper', 'meadow');
    const learn = cc.getByRole('button', { name: 'Learn Mode' });
    await expect(learn).toHaveAttribute('aria-pressed', 'true'); // on by default
    await learn.click();
    await expect(learn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('Command journal', { exact: false })).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(cc).toBeHidden();
  });

  test('lists the servers with the active one selected', async ({ page }) => {
    await page.getByRole('button', { name: 'Control Center' }).click();
    await expect(page.getByRole('radio', { name: /vps-a/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

test.describe('Toasts', () => {
  test('recording announces itself, and a toast can be dismissed', async ({ page }) => {
    await page.getByRole('button', { name: 'Start recording' }).click();
    const started = page.getByRole('status').filter({ hasText: 'Recording started' });
    await expect(started).toBeVisible();
    await started.getByRole('button', { name: 'Dismiss notification' }).click();
    await expect(started).toBeHidden();
    await page.getByRole('button', { name: 'Stop recording' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Recording saved' })).toBeVisible();
  });
});

test.describe('Per-app menus', () => {
  test('Terminal: Edit > Select All + Copy puts the output on the clipboard', async ({ page }) => {
    await openApp(page, 'terminal');
    const term = page.locator('.xterm-rows');
    await expect(term).toContainText('gfv@', { timeout: 20_000 });
    await page.locator('.xterm').click();
    await page.keyboard.type('echo menu-$((2+3))\n');
    await expect(term).toContainText('menu-5');
    await page.getByRole('button', { name: 'Edit menu' }).click();
    await page.getByRole('menuitem', { name: 'Select All' }).click();
    await page.getByRole('button', { name: 'Edit menu' }).click();
    await page.getByRole('menuitem', { name: 'Copy' }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('menu-5');
  });

  test('Terminal: right-click opens a small menu, and File has New Tab', async ({ page }) => {
    await openApp(page, 'terminal');
    await expect(page.locator('.xterm-rows')).toContainText('gfv@', { timeout: 20_000 });
    await page.locator('.xterm').click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Terminal' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Clear Terminal' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'File menu' }).click();
    await page.getByRole('menuitem', { name: 'New Tab' }).click();
    await expect(page.getByRole('tab')).toHaveCount(2);
  });

  test('Files: right-click on a row and on empty space give different menus', async ({ page }) => {
    await openApp(page, 'files');
    await gotoPath(page, '/etc');
    await page.getByTestId('file-row').first().click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'File actions' });
    await expect(menu.getByRole('menuitem', { name: 'Rename…' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Delete…' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page
      .getByText(/items$/)
      .first()
      .waitFor();
    // File menu in the bar: this window's items come first.
    await page.getByRole('button', { name: 'File menu' }).click();
    await expect(page.getByRole('menuitem').first()).toHaveText('New Folder…');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'View menu' }).click();
    await expect(page.getByRole('menuitemcheckbox', { name: 'Show Hidden Files' })).toBeVisible();
  });

  test('Editor: Edit > Find opens Monaco’s find widget', async ({ page }) => {
    await openApp(page, 'files');
    await gotoPath(page, '/etc');
    await page.getByTestId('file-row').filter({ hasText: 'hostname' }).first().dblclick();
    await page.locator('.monaco-editor').waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Edit menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Undo' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Find…' }).click();
    await expect(page.locator('.find-widget.visible')).toBeVisible();
  });
});
