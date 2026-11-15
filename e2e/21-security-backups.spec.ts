import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { auditContrast, prepare, settle } from './a11y';
import { KEY, api, confirmRun, openApp, openGfv, vpsUp } from './helpers';

// M15 in the browser, on the real-systemd server (vps-systemd, port 2204): the security checkup with a real fix, and
// a backup schedule made, run and restored through the UI.
const box = (cmd: string) =>
  execSync(`docker exec gfv-vps-systemd sh -c ${JSON.stringify(cmd)}`, { encoding: 'utf8' }).trim();
const CLEAN =
  'rm -f /etc/ssh/sshd_config.d/10-gfv-e2e.conf /etc/ssh/sshd_config.d/00-gfv-hardening.conf; rm -rf /home/gfv/.gfv/guard /home/gfv/gfv-restore /home/gfv/.gfv/backups; ' +
  'systemctl disable --now gfv-backup-e2e.timer >/dev/null 2>&1; rm -f /etc/systemd/system/gfv-backup-e2e.* /usr/local/lib/gfv/backup-e2e.sh; systemctl daemon-reload; systemctl reload ssh; true';

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

test('Security checkup: find a risky SSH setting, fix it, undo it', async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!(await vpsUp(2204)), 'the systemd test server (port 2204) is not running');
  box(CLEAN);
  box(
    "printf 'PermitRootLogin yes\\n' > /etc/ssh/sshd_config.d/10-gfv-e2e.conf; systemctl reload ssh",
  );
  await openGfv(page);
  await useSystemdServer(page);
  try {
    await openApp(page, 'security');
    const root = page.locator('[data-testid="sec-finding"][data-id="ssh.root-login"]');
    await expect(root).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('sec-finding').first()).toBeVisible();
    await root.getByRole('button', { name: /Forbid root logins/ }).click();
    await expect(page.getByTestId('guard-note')).toBeVisible();
    await confirmRun(page);
    await expect(root).toHaveCount(0, { timeout: 60_000 });
    expect(box("sshd -T | grep -i '^permitrootlogin '")).toContain('no');

    // The change is listed with an Undo, which brings the old setting back.
    const undo = page.getByTestId('sec-undo').first();
    await expect(undo).toContainText('Harden SSH logins', { timeout: 30_000 });
    await undo.getByRole('button', { name: 'Undo' }).click();
    await confirmRun(page);
    await expect(root).toBeVisible({ timeout: 60_000 });
  } finally {
    box(CLEAN);
  }
});

test('Backups: schedule, back up now, restore into a folder', async ({ page }) => {
  test.setTimeout(300_000);
  test.skip(!(await vpsUp(2204)), 'the systemd test server (port 2204) is not running');
  box(CLEAN);
  await openGfv(page);
  await useSystemdServer(page);
  try {
    await openApp(page, 'backups');
    await expect(page.getByText('No backups yet')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'New schedule' }).click();
    await page.getByLabel(/^Name/).fill('e2e');
    await page.getByLabel(/Folders to back up/).fill('/etc/ssh');
    await page.getByRole('button', { name: 'Review…' }).click();
    await expect(
      page.getByText('systemctl enable --now gfv-backup-e2e.timer').first(),
    ).toBeVisible();
    await confirmRun(page);
    const job = page.getByTestId('backup-job').filter({ hasText: 'e2e' });
    await expect(job).toContainText('scheduled', { timeout: 30_000 });
    await expect(job).toContainText('Every day at 03:00');

    await job.getByRole('button', { name: 'Back up now' }).click();
    await confirmRun(page);
    // "Persistent" timers catch up a missed run at once: depending on the time of day there are 1 or 2 archives.
    await expect(page.getByTestId('backup-archive').first()).toBeVisible({ timeout: 30_000 });
    expect(Number(box('ls /home/gfv/.gfv/backups/e2e | grep -c tar.gz'))).toBeGreaterThanOrEqual(1);

    await page
      .getByRole('button', { name: /^Restore .* into a folder$/ })
      .first()
      .click();
    await confirmRun(page);
    expect(box('ls /home/gfv/gfv-restore/*/etc/ssh')).toContain('sshd_config');

    // Stop the schedule: the archive stays.
    await job.getByRole('button', { name: 'Stop schedule' }).click();
    await page.getByRole('button', { name: 'Review…' }).click();
    await confirmRun(page);
    await expect(page.getByText('No backups yet')).toBeVisible({ timeout: 30_000 });
    expect(Number(box('ls /home/gfv/.gfv/backups/e2e | grep -c tar.gz'))).toBeGreaterThanOrEqual(1);
  } finally {
    box(CLEAN);
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`Security and Backups contrast with real data (${theme})`, async ({ page }) => {
    test.setTimeout(240_000);
    test.skip(!(await vpsUp(2204)), 'the systemd test server (port 2204) is not running');
    box(CLEAN);
    box(
      "printf 'PermitRootLogin yes\\n' > /etc/ssh/sshd_config.d/10-gfv-e2e.conf; systemctl reload ssh",
    );
    try {
      await prepare(page, theme);
      await useSystemdServer(page);
      await openApp(page, 'security');
      await expect(page.getByTestId('sec-finding').first()).toBeVisible({ timeout: 60_000 });
      await settle(page);
      if (process.env.SHOT_DIR)
        await page.screenshot({ path: `${process.env.SHOT_DIR}/security-${theme}.png` });
      const failures = (await auditContrast(page)).map((f) => `[${theme}] security: ${f}`);
      await page.getByTestId('window').last().getByRole('button', { name: 'Close' }).click();
      await openApp(page, 'backups');
      await expect(page.getByText('No backups yet')).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'New schedule' }).click();
      await settle(page);
      failures.push(...(await auditContrast(page)).map((f) => `[${theme}] backup dialog: ${f}`));
      expect(failures, failures.join('\n')).toEqual([]);
    } finally {
      box(CLEAN);
    }
  });
}
