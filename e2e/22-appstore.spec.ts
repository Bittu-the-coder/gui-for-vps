import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { auditContrast, prepare, settle } from './a11y';
import { KEY, api, confirmRun, openApp, openGfv, vpsUp } from './helpers';

// M20 in the browser, on the real-systemd server with REAL Docker (vps-systemd, port 2204).
// No host shell in between: `$a` and `$1` must reach the container untouched.
const box = (cmd: string) =>
  execFileSync('docker', ['exec', 'gfv-vps-systemd', 'sh', '-c', cmd], { encoding: 'utf8' }).trim();
const CLEAN =
  'for a in whoami redis; do docker rm -f gfv-$a >/dev/null 2>&1; docker volume rm gfv-$a-data >/dev/null 2>&1; done; rm -rf /home/gfv/.gfv/apps; true';
const dockerReady = () => {
  try {
    return box('docker info >/dev/null 2>&1 && echo yes') === 'yes';
  } catch {
    return false;
  }
};

async function useSystemdServer(page: Page) {
  const servers = await api<{ id: string; name: string }[]>(page, 'GET', '/api/servers');
  let id = servers.find((s) => s.name === 'systemd')?.id;
  if (!id) {
    id = (
      await api<{ id: string }>(page, 'POST', '/api/servers', {
        name: 'systemd',
        host: '127.0.0.1',
        port: 2204,
        username: 'gfv',
        authType: 'key',
        privateKey: KEY,
      })
    ).id;
    const first = await api<{ fingerprint: string }>(page, 'POST', `/api/servers/${id}/connect`);
    await api(page, 'POST', `/api/servers/${id}/trust-host-key`, {
      fingerprint: first.fingerprint,
    });
  }
  await api(page, 'POST', `/api/servers/${id}/connect`);
  await page.reload();
  await page.getByRole('button', { name: 'Active server' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'systemd' }).click();
}

test('App Store: install, use, stop, start and remove a real container', async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(
    !(await vpsUp(2204)) || !dockerReady(),
    'the systemd test server with Docker is not running',
  );
  box(CLEAN);
  await openGfv(page);
  await useSystemdServer(page);
  try {
    await openApp(page, 'appstore');
    const card = page.locator('[data-testid="store-app"][data-app="whoami"]');
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole('button', { name: 'Install…' }).click();
    await page.getByLabel('Port on this server').fill('18091');
    await page.getByRole('button', { name: 'Review…' }).click();
    await expect(page.getByText('docker run -d --name gfv-whoami').first()).toBeVisible();
    await expect(page.getByText('-p 127.0.0.1:18091:80').first()).toBeVisible(); // not exposed by default
    await confirmRun(page);
    await expect(card).toContainText('running', { timeout: 30_000 });
    await expect(card).toContainText('this server only');
    expect(box('curl -s -m 5 127.0.0.1:18091')).toContain('Hostname:');

    await card.getByRole('button', { name: 'Stop whoami' }).click();
    await confirmRun(page);
    await expect(card).toContainText('stopped', { timeout: 30_000 });
    await card.getByRole('button', { name: 'Start whoami', exact: true }).click();
    await confirmRun(page);
    await expect(card).toContainText('running', { timeout: 30_000 });

    // An app with a password: it is generated on the server and shown only on request.
    const redis = page.locator('[data-testid="store-app"][data-app="redis"]');
    await redis.getByRole('button', { name: 'Install…' }).click();
    await page.getByRole('button', { name: 'Review…' }).click();
    await confirmRun(page);
    await expect(redis).toContainText('running', { timeout: 60_000 });
    await redis.getByRole('button', { name: 'Show credentials' }).click();
    await expect(page.getByTestId('credential')).toHaveText(/^[A-Za-z0-9]{24}$/);
    await page.getByRole('button', { name: 'Close' }).last().click();

    await card.getByRole('button', { name: 'Remove whoami' }).click();
    await confirmRun(page);
    await expect(card.getByRole('button', { name: 'Install…' })).toBeVisible({ timeout: 30_000 });
    expect(box('docker volume ls -q')).toContain('gfv-whoami-data'); // data is kept
  } finally {
    box(CLEAN);
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`App Store contrast with a running app (${theme})`, async ({ page }) => {
    test.setTimeout(240_000);
    test.skip(
      !(await vpsUp(2204)) || !dockerReady(),
      'the systemd test server with Docker is not running',
    );
    box(CLEAN);
    box(
      'docker run -d --name gfv-whoami --label gfv.app=whoami -p 127.0.0.1:18092:80 traefik/whoami:v1.10.3 >/dev/null',
    );
    try {
      await prepare(page, theme);
      await useSystemdServer(page);
      await openApp(page, 'appstore');
      await expect(page.locator('[data-app="whoami"]')).toContainText('running', {
        timeout: 30_000,
      });
      await settle(page);
      if (process.env.SHOT_DIR)
        await page.screenshot({ path: `${process.env.SHOT_DIR}/appstore-${theme}.png` });
      const failures = (await auditContrast(page)).map((f) => `[${theme}] app store: ${f}`);
      await page
        .locator('[data-app="uptime-kuma"]')
        .getByRole('button', { name: 'Install…' })
        .click();
      await settle(page);
      failures.push(...(await auditContrast(page)).map((f) => `[${theme}] install dialog: ${f}`));
      expect(failures, failures.join('\n')).toEqual([]);
    } finally {
      box(CLEAN);
    }
  });
}
