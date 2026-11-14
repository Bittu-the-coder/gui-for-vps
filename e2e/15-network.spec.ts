import { expect, test, type Page } from '@playwright/test';
import { api, confirmRun, openApp, openGfv, vpsUp } from './helpers';

// M17 in the browser: ports, and nginx sites on REAL nginx (installed on vps-a through the Command Runner).
async function runAndWait(page: Page, serverId: string, actionId: string, params: object = {}) {
  const r = await api<{ runId: string }>(page, 'POST', '/api/runs', {
    serverId,
    actionId,
    params,
    confirmed: true,
  });
  await expect
    .poll(
      async () =>
        (
          await api<{
            entries: { id: string; exitCode: number | null; finishedAt: number | null }[];
          }>(page, 'GET', '/api/history?limit=50')
        ).entries.find((e) => e.id === r.runId)?.finishedAt,
      { timeout: 240_000 },
    )
    .toBeTruthy();
}

test('Network app: ports, then add and remove an nginx site (real nginx)', async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  const a = (await api<{ id: string; name: string }[]>(page, 'GET', '/api/servers')).find(
    (s) => s.name === 'vps-a',
  )!.id;

  await openApp(page, 'network');
  // Ports tab: this image has no `ss`: the app says so instead of showing an empty table.
  await expect(page.getByRole('tab', { name: 'Ports' })).toHaveAttribute('aria-selected', 'true');
  await expect(
    page
      .getByText(/ss.* tool is not installed|No listening ports|port-row/)
      .or(page.getByTestId('port-row').first()),
  ).toBeVisible({ timeout: 15_000 });

  // Sites tab without nginx.
  await page.getByRole('tab', { name: /Sites/ }).click();
  const noNginx = page.getByText('nginx is not installed');
  const stockSite = page.getByTestId('site-row').first();
  // Wait for a DEFINITE answer (the first poll must have finished): either the message or a site row.
  await expect(noNginx.or(stockSite)).toBeVisible({ timeout: 20_000 });
  const installed = await stockSite.isVisible();
  if (!installed) {
    await runAndWait(page, a, 'devhub.install.nginx');
    await expect(stockSite).toBeVisible({ timeout: 30_000 }); // the stock "default" site
  }

  // Add a site: a bad domain is refused in the dialog, with the reason.
  await page.getByRole('button', { name: 'Add site' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a site' });
  await dialog.getByLabel('Domain').fill('bad domain; rm -rf /');
  await dialog.getByRole('button', { name: 'Review…' }).click();
  await expect(dialog.getByRole('alert')).toContainText('domain');
  await dialog.getByLabel('Domain').fill('e2e-site.test');
  await dialog.getByLabel('Port your app listens on').fill('3456');
  await dialog.getByRole('button', { name: 'Review…' }).click();

  // The Run dialog shows exactly what will happen, including the safety check and rollback.
  await expect(page.getByText('nginx -t ||').first()).toBeVisible();
  await expect(page.getByText('/etc/nginx/sites-available/e2e-site.test').first()).toBeVisible();
  await confirmRun(page);
  const row = page.getByTestId('site-row').filter({ hasText: 'e2e-site.test' });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText('127.0.0.1:3456');
  await expect(row).toContainText('enabled');

  // Remove it: a confirmation, then the preview, then it is gone.
  await row.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Review…' }).click();
  await confirmRun(page);
  await expect(page.getByTestId('site-row').filter({ hasText: 'e2e-site.test' })).toHaveCount(0, {
    timeout: 20_000,
  });

  if (!installed) await runAndWait(page, a, 'devhub.uninstall.nginx'); // leave the server as we found it
});
