import { expect, test } from '@playwright/test';
import { api, confirmRun, gotoPath, openApp, openGfv, vpsUp } from './helpers';

test('record two folders, stop, and export a bash script', async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  const sid = (await api<{ id: string }[]>(page, 'GET', '/api/servers'))[0]!.id;
  const base = `e2e-rec-${Date.now()}`;

  await openApp(page, 'files');
  await gotoPath(page, '/tmp');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  for (const name of [base, `${base}-b`]) {
    await page.getByRole('button', { name: 'New folder' }).click();
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Create' }).click();
    await confirmRun(page);
  }
  await expect(page.getByRole('button', { name: /Stop recording/ })).toContainText('(2)');
  await page.getByRole('button', { name: 'Stop recording' }).click();

  await expect(page.getByTestId('recipe-step')).toHaveCount(2);
  await page.getByRole('button', { name: 'Script', exact: true }).click();
  const script = page.getByTestId('script-view');
  await expect(script).toContainText('set -euo pipefail');
  await expect(script).toContainText(`mkdir -p -- /tmp/${base}`);
  await expect(script).toContainText(`mkdir -p -- /tmp/${base}-b`);

  // reorder through the UI, then the script follows
  await page.getByRole('button', { name: 'Steps', exact: true }).click();
  await page.getByRole('button', { name: 'Move down' }).first().click();
  await page.getByRole('button', { name: 'Script', exact: true }).click();
  await expect(script).toContainText('set -euo pipefail'); // the regenerated script has loaded
  const text = await script.innerText();
  const first = text.indexOf(`/tmp/${base}-b`);
  const second = text.search(new RegExp(`/tmp/${base}(?!-b)`));
  expect(first).toBeGreaterThan(-1);
  expect(first).toBeLessThan(second);

  for (const p of [base, `${base}-b`]) {
    await api(page, 'POST', '/api/runs', {
      serverId: sid,
      actionId: 'files.delete-path',
      params: { path: `/tmp/${p}` },
      confirmed: true,
    });
  }
});
