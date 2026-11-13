import { expect, test } from '@playwright/test';
import { confirmRun, openApp, openGfv, vpsUp } from './helpers';

test('an action shows its preview, runs, and lands in the Learn journal', async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  await openApp(page, 'actions');
  await page.getByRole('button', { name: 'Run…' }).first().click(); // "Show uptime and load"
  await expect(page.getByText('Commands GFV will run')).toBeVisible();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByLabel('Output')).toContainText('load average', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Close' }).last().click();
  await expect(page.getByRole('complementary', { name: 'Learn Mode' })).toContainText(
    'Show uptime and load',
  );
  await expect(page.getByTestId('learned-count')).not.toHaveText('0');
});

test('a dangerous action needs the checkbox before it can run', async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  await openApp(page, 'actions');
  await page.getByPlaceholder('/tmp/old-stuff').fill('/tmp/e2e-does-not-matter');
  await page
    .locator('div.rounded.border', { hasText: 'Delete a file or folder' })
    .getByRole('button', { name: 'Run…' })
    .click();
  await expect(page.getByText('This can seriously damage the server')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run anyway' })).toBeDisabled();
  await confirmRun(page);
});
