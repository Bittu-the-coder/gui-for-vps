// Not a test of behaviour: screenshots for the README gallery (docs/screenshots/*.png).
// Run on demand:  CAPTURE_DOCS=1 pnpm exec playwright test --config e2e/playwright.config.ts 01-onboarding capture-gallery
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { KEY, api, openApp, openGfv, vpsUp } from './helpers';

const OUT = join(import.meta.dirname, '..', 'docs', 'screenshots');
test.skip(!process.env.CAPTURE_DOCS, 'only when capturing docs (CAPTURE_DOCS=1)');
test.use({ viewport: { width: 1320, height: 800 } });

const box = (cmd: string) =>
  execFileSync('docker', ['exec', 'gfv-vps-systemd', 'sh', '-c', cmd], { encoding: 'utf8' }).trim();
const shot = async (page: Page, name: string, wait = 1200) => {
  mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
};
const closeAllWindows = async (page: Page) => {
  const wins = page.getByTestId('window');
  for (let i = 0; i < 12 && (await wins.count()) > 0; i++) {
    await wins.last().getByRole('button', { name: 'Close' }).first().click(); // the traffic light comes first
    await page.waitForTimeout(350);
  }
};
const closeLearn = async (page: Page) => {
  const learn = page.getByRole('complementary', { name: 'Learn Mode' });
  if (await learn.isVisible().catch(() => false))
    await page.getByRole('button', { name: 'Toggle Learn Mode' }).first().click();
};

test('gallery', async ({ page, browser }) => {
  test.setTimeout(480_000);
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  await closeLearn(page);

  // A working desktop: several windows on the first server.
  await openApp(page, 'monitor');
  await page.waitForTimeout(4000);
  await openApp(page, 'files');
  await openApp(page, 'terminal');
  await expect(page.locator('.xterm-rows')).toContainText('gfv@', { timeout: 20_000 });
  await page.locator('.xterm').click();
  await page.keyboard.type('uname -a && uptime\n');
  await shot(page, 'desktop', 2000);

  // The real-systemd server: firewall with rules and the lockout protection text.
  if (await vpsUp(2204)) {
    box(
      'ufw --force reset >/dev/null 2>&1; ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw deny from 203.0.113.9 >/dev/null; ufw --force enable >/dev/null',
    );
    const servers = await api<{ id: string; name: string }[]>(page, 'GET', '/api/servers');
    let id = servers.find((s) => s.name === 'systemd')?.id;
    if (!id) {
      id = (
        await api<{ id: string }>(page, 'POST', '/api/servers', {
          name: 'web-server',
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
    await closeLearn(page);
    await page.getByRole('button', { name: 'Active server' }).click();
    await page.getByRole('menuitemcheckbox', { name: /systemd|web-server/ }).click();
    await openApp(page, 'firewall');
    await expect(page.getByTestId('fw-rule').first()).toBeVisible({ timeout: 20_000 });
    await closeAllWindows(page); // the firewall on its own, no other windows behind it
    await openApp(page, 'firewall');
    await expect(page.getByTestId('fw-rule').first()).toBeVisible({ timeout: 20_000 });
    await shot(page, 'firewall', 1500);
    await page.setViewportSize({ width: 1320, height: 1150 }); // tall enough for the whole dialog
    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.getByLabel('What to do').selectOption('deny');
    await page.getByLabel('Port (or a range like 8000:8100)').fill('22');
    await expect(page.getByTestId('rule-lockout-hint')).toBeVisible();
    await page.getByRole('button', { name: 'Review…' }).click();
    await page.getByText('What this does').waitFor();
    await page.waitForTimeout(1200);
    mkdirSync(OUT, { recursive: true });
    await page.getByRole('dialog').screenshot({ path: join(OUT, 'lockout-protection.png') }); // the whole dialog, even if taller than the window
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.setViewportSize({ width: 1320, height: 800 });
    await closeAllWindows(page);
    // Give the checkup something to find: root login allowed and no firewall.
    box(
      "printf 'PermitRootLogin yes\\n' > /etc/ssh/sshd_config.d/10-demo.conf; systemctl reload ssh; ufw --force disable >/dev/null 2>&1; true",
    );

    await openApp(page, 'security');
    await expect(page.getByTestId('sec-finding').first()).toBeVisible({ timeout: 150_000 });
    await shot(page, 'security-checkup', 1500);
    await page
      .getByRole('button', { name: 'Close' })
      .first()
      .click()
      .catch(() => {});
    await openApp(page, 'appstore');
    await expect(page.locator('[data-testid="store-app"]').first()).toBeVisible({
      timeout: 30_000,
    });
    await shot(page, 'app-store', 1500);
    box(
      'rm -f /etc/ssh/sshd_config.d/10-demo.conf; systemctl reload ssh; ufw --force reset >/dev/null 2>&1; true',
    );
  }

  // Dark theme, on a phone-sized screen.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    colorScheme: 'dark',
  });
  const m = await phone.newPage();
  await openGfv(m);
  await shot(m, 'phone', 1500);
  await phone.close();
});
