// Not a test of behaviour: records the README demo (docs/demo.webm -> docs/demo.gif) and screenshots.
// Run on demand:  CAPTURE_DOCS=1 pnpm exec playwright test --config e2e/playwright.config.ts capture-docs
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { api, confirmRun, gotoPath, openApp, openGfv, vpsUp } from './helpers';

const OUT = join(import.meta.dirname, '..', 'docs');
test.skip(!process.env.CAPTURE_DOCS, 'only when capturing docs (CAPTURE_DOCS=1)');
test.use({
  video: { mode: 'on', size: { width: 1100, height: 680 } },
  viewport: { width: 1100, height: 680 },
});

test('capture the demo', async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  const pause = (ms = 900) => page.waitForTimeout(ms);
  await pause();

  // Dev Hub: see what is installed, preview an install (Learn Mode shows the real commands)
  await openApp(page, 'devhub');
  await expect(page.getByText(/Detected Ubuntu/)).toBeVisible();
  await pause(1200);
  await page.getByTestId('tool-git').getByRole('button', { name: 'Install' }).click();
  await expect(page.getByText('What this does')).toBeVisible();
  await pause(2500);
  await page.screenshot({ path: join(OUT, 'preview.png') });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page
    .getByLabel('Close')
    .first()
    .click()
    .catch(() => {});

  // Monitor
  await openApp(page, 'monitor');
  await expect(page.getByText('Load average')).toBeVisible();
  await pause(5000);
  await page.screenshot({ path: join(OUT, 'monitor.png') });

  // Record a recipe through the File Manager (Learn panel closed: the windows get more room)
  await page.getByRole('button', { name: 'Toggle Learn Mode' }).click();
  await openApp(page, 'files');
  await gotoPath(page, '/tmp');
  await page.getByRole('button', { name: 'Start recording' }).click();
  const name = `demo-${Date.now() % 100000}`;
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await pause(1500);
  await confirmRun(page);
  await pause(800);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: 'Script', exact: true }).click();
  await expect(page.getByTestId('script-view')).toContainText('mkdir');
  await pause(2500);
  await page.screenshot({ path: join(OUT, 'recipe.png') });

  const sid = (await api<{ id: string }[]>(page, 'GET', '/api/servers'))[0]!.id;
  await api(page, 'POST', '/api/runs', {
    serverId: sid,
    actionId: 'files.delete-path',
    params: { path: `/tmp/${name}` },
    confirmed: true,
  });
  await pause(500);
});
