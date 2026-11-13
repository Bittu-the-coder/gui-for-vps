import { expect, test } from '@playwright/test';
import { openApp, openGfv, vpsUp } from './helpers';

test('the terminal runs a command on the server', async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  await openApp(page, 'terminal');
  const term = page.locator('.xterm-rows');
  await expect(term).toContainText('gfv@', { timeout: 20_000 }); // the shell prompt
  await page.locator('.xterm').click();
  await page.keyboard.type('echo e2e-$((6*7))\n');
  // "e2e-42" only exists as the command's RESULT: the typed text has "$((6*7))" in it.
  await expect(term).toContainText('e2e-42');
});

test('a dangerous command is held until you confirm, and Cancel abandons it', async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  await openApp(page, 'terminal');
  await expect(page.locator('.xterm-rows')).toContainText('gfv@', { timeout: 20_000 });
  await page.locator('.xterm').click();
  await page.keyboard.type('rm -rf /\n');
  await expect(page.getByRole('alertdialog', { name: 'Dangerous command' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await page.keyboard.type('echo still-here-$((1+1))\n');
  await expect(page.locator('.xterm-rows')).toContainText('still-here-2');
});
