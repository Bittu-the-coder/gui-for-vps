import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { auditContrast, prepare, settle } from './a11y';
import { KEY, api, confirmRun, openApp, openGfv, vpsUp } from './helpers';

// M14 in the browser, on a REAL server with real systemd and a real firewall (vps-systemd, port 2204):
//   docker compose -f e2e/docker-compose.yml --profile systemd up -d --build vps-systemd
const box = (cmd: string) =>
  execSync(`docker exec gfv-vps-systemd sh -c ${JSON.stringify(cmd)}`, { encoding: 'utf8' }).trim();

async function useSystemdServer(page: Page): Promise<string> {
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
  return id;
}

test('Firewall: turn it on, add a rule, undo it, and survive a rule that locks GFV out', async ({
  page,
}) => {
  test.setTimeout(300_000);
  test.skip(!(await vpsUp(2204)), 'the systemd test server (port 2204) is not running');
  box('ufw --force reset >/dev/null 2>&1; rm -rf /home/gfv/.gfv/guard');
  await openGfv(page);
  await useSystemdServer(page);
  try {
    await openApp(page, 'firewall');
    const state = page.getByTestId('fw-state');
    await expect(state).toHaveText('Firewall is off', { timeout: 20_000 });

    // Turn on: the preview says the SSH port is allowed first and explains the safety timer.
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByTestId('guard-note')).toContainText('40-second safety timer');
    await expect(page.getByText('ufw allow 22/tcp').first()).toBeVisible();
    await confirmRun(page);
    await expect(state).toHaveText('Firewall is on', { timeout: 20_000 });
    await expect(page.getByTestId('fw-rule').filter({ hasText: '22/tcp' })).toContainText(
      'SSH: how GFV connects',
    );

    // Add a rule through the dialog.
    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.getByLabel('Port (or a range like 8000:8100)').fill('8080');
    await page.getByRole('button', { name: 'Review…' }).click();
    await confirmRun(page);
    await expect(page.getByTestId('fw-rule').filter({ hasText: '8080/tcp' })).toBeVisible({
      timeout: 20_000,
    });
    expect(box('ufw status')).toContain('8080/tcp');

    // Undo timeline: undo the change that added 8080.
    await page.getByRole('tab', { name: /Undo timeline/ }).click();
    const newest = page.getByTestId('fw-backup').first();
    await expect(newest).toContainText('Add a firewall rule');
    await expect(newest).toContainText('confirmed');
    await newest.getByRole('button', { name: 'Undo this change' }).click();
    await confirmRun(page);
    expect(box('ufw status')).not.toContain('8080/tcp');
    await page.getByRole('tab', { name: 'Rules' }).click();
    await expect(page.getByTestId('fw-rule').filter({ hasText: '8080/tcp' })).toHaveCount(0, {
      timeout: 20_000,
    });

    // The dialog warns BEFORE you review a rule that matches SSH.
    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.getByLabel('What to do').selectOption('deny');
    await page.getByLabel('Port (or a range like 8000:8100)').fill('22');
    await expect(page.getByTestId('rule-lockout-hint')).toBeVisible();
    await page.getByRole('button', { name: 'Review…' }).click();

    // Danger: the checkbox is required, and the run LOCKS GFV OUT FOR REAL. The server undoes it by itself.
    await page.getByText('What this does').waitFor();
    await expect(page.getByTestId('guard-note')).toBeVisible();
    await page.getByLabel('I understand the risk').check();
    await page.getByRole('button', { name: 'Run anyway' }).click();
    await expect(page.getByTestId('run-result')).toContainText('Undone automatically', {
      timeout: 120_000,
    });
    expect(box('ufw status')).not.toMatch(/22\/tcp\s+DENY/);
    expect(box('ufw status')).toMatch(/22\/tcp\s+ALLOW/);
    await page.getByRole('button', { name: 'Close' }).last().click();

    // The timeline remembers that it was undone automatically.
    await page.getByRole('tab', { name: /Undo timeline/ }).click();
    await expect(page.getByTestId('fw-backup').first()).toContainText('undone automatically', {
      timeout: 20_000,
    });
  } finally {
    box('ufw --force reset >/dev/null 2>&1; rm -rf /home/gfv/.gfv/guard');
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`Firewall app contrast with real rules (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!(await vpsUp(2204)), 'the systemd test server (port 2204) is not running');
    box(
      'ufw --force reset >/dev/null 2>&1; ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw deny from 10.0.0.0/8 >/dev/null; ufw --force enable >/dev/null',
    );
    try {
      await prepare(page, theme);
      await useSystemdServer(page);
      await openApp(page, 'firewall');
      await expect(page.getByTestId('fw-rule').first()).toBeVisible({ timeout: 20_000 });
      await settle(page);
      if (process.env.SHOT_DIR)
        await page.screenshot({ path: `${process.env.SHOT_DIR}/firewall-${theme}.png` });
      const failures = (await auditContrast(page)).map((f) => `[${theme}] firewall: ${f}`);
      await page.getByRole('tab', { name: /Undo timeline/ }).click();
      await settle(page);
      if (process.env.SHOT_DIR)
        await page.screenshot({ path: `${process.env.SHOT_DIR}/firewall-undo-${theme}.png` });
      failures.push(...(await auditContrast(page)).map((f) => `[${theme}] undo timeline: ${f}`));
      await page.getByRole('button', { name: 'Add rule' }).click();
      await settle(page);
      failures.push(...(await auditContrast(page)).map((f) => `[${theme}] rule dialog: ${f}`));
      expect(failures, failures.join('\n')).toEqual([]);
    } finally {
      box('ufw --force reset >/dev/null 2>&1; rm -rf /home/gfv/.gfv/guard');
    }
  });
}
