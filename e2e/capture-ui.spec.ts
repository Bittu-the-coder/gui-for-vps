// Not a test of behaviour: screenshots of every screen in both themes, for before/after comparisons
// of the redesign. Run on demand (it needs the server that spec 01 adds, so run both):
//   CAPTURE_UI=before pnpm exec playwright test --config e2e/playwright.config.ts 01-onboarding capture-ui
// Output: docs/redesign/<label>/<theme>-<screen>.png (that folder is ignored by git)
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MASTER, TOKEN, gotoPath, openApp, vpsUp } from './helpers';

const LABEL = process.env.CAPTURE_UI;
test.skip(!LABEL, 'only when capturing UI screenshots (CAPTURE_UI=before|after)');
const OUT = join(import.meta.dirname, '..', 'docs', 'redesign', LABEL ?? 'x');

/** Only hooks that exist before AND after the redesign. */
const desktopReady = (page: Page) => page.locator('[data-tour="server-switcher"]');

async function fresh(page: Page) {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(desktopReady(page)).toBeVisible();
}

for (const theme of ['light', 'dark'] as const) {
  test(`capture ${theme}`, async ({ browser }) => {
    test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
    const ctx = await browser.newContext({
      colorScheme: theme,
      viewport: { width: 1400, height: 850 },
    });
    const page = await ctx.newPage();
    const shot = async (name: string, wait = 600) => {
      await page.waitForTimeout(wait);
      mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: join(OUT, `${theme}-${name}.png`) });
    };

    // Unlock screen: sign in, lock through the API, reload.
    await page.goto(`/?token=${TOKEN}`);
    await page.evaluate(() => fetch('/api/vault/lock', { method: 'POST' }));
    await page.reload();
    await expect(page.getByLabel('Master password')).toBeVisible();
    await shot('unlock');
    await page.getByLabel('Master password').fill(MASTER);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(desktopReady(page)).toBeVisible();
    // Locking disconnected every server: connect again (the host key is already trusted).
    await page.evaluate(async () => {
      const servers = (await (await fetch('/api/servers')).json()) as { id: string }[];
      await fetch(`/api/servers/${servers[0]!.id}/connect`, { method: 'POST' });
    });

    // First visit shows the tour.
    await fresh(page);
    await expect(page.getByRole('dialog', { name: 'Tour' })).toBeVisible();
    await shot('tour');
    await page.getByText('Skip tour').click();
    await shot('desktop');

    const app = async (id: string, name: string, ready: () => Promise<unknown>, wait = 800) => {
      await fresh(page);
      if (await page.getByText('Skip tour').isVisible()) await page.getByText('Skip tour').click();
      await openApp(page, id);
      await ready();
      await shot(name, wait);
    };

    await app('servers', 'servers', () => expect(page.getByText('vps-a').first()).toBeVisible());
    await app('terminal', 'terminal', () => page.waitForTimeout(3000));
    await app('files', 'files', async () => {
      await gotoPath(page, '/etc');
    });
    await app(
      'files',
      'editor',
      async () => {
        await gotoPath(page, '/etc');
        await page.getByTestId('file-row').filter({ hasText: 'hostname' }).first().dblclick();
        await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
      },
      2000,
    );
    await app(
      'monitor',
      'monitor',
      () => expect(page.getByText('Load average')).toBeVisible(),
      5000,
    );
    await app('services', 'services', () => page.waitForTimeout(2500));
    await app('docker', 'docker', () => page.waitForTimeout(2500));
    await app('devhub', 'devhub', () => expect(page.getByText(/Detected Ubuntu/)).toBeVisible());
    await app('snapshots', 'snapshots', () => page.waitForTimeout(1500));
    await app('recipes', 'recipes', () => page.waitForTimeout(1500));

    // Run dialog (preview of an install: Learn Mode panel open next to it).
    await fresh(page);
    if (await page.getByText('Skip tour').isVisible()) await page.getByText('Skip tour').click();
    await openApp(page, 'devhub');
    await expect(page.getByText(/Detected Ubuntu/)).toBeVisible();
    await page.getByTestId('tool-git').getByRole('button', { name: 'Install' }).click();
    await expect(page.getByText('What this does')).toBeVisible();
    await shot('run-dialog', 1500);
    await page.getByRole('button', { name: 'Cancel' }).click();

    // A busy desktop: several windows at once.
    await fresh(page);
    if (await page.getByText('Skip tour').isVisible()) await page.getByText('Skip tour').click();
    for (const id of ['terminal', 'files', 'monitor']) {
      await openApp(page, id);
      await page.waitForTimeout(500);
    }
    await shot('multi-window', 4000);
    // M10b surfaces (these hooks exist only after the redesign, so a "before" run skips them).
    if (LABEL !== 'before') {
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox').fill('t');
      await shot('spotlight', 500);
      await page.keyboard.press('Escape');

      await page.mouse.click(300, 760); // empty desktop
      await page.keyboard.press('Control+ArrowUp');
      await shot('mission-control', 900);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Control Center' }).click();
      await shot('control-center', 500);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Start recording' }).click();
      await shot('toast', 700);
      await page.getByRole('button', { name: 'Stop recording' }).click();

      await page.getByRole('button', { name: 'Edit menu' }).click();
      await shot('menu-edit', 300);
      await page.keyboard.press('Escape');

      await openApp(page, 'files');
      await page.waitForTimeout(800);
      await page.getByTestId('file-row').first().click({ button: 'right' });
      await shot('context-menu-files', 300);
      await page.keyboard.press('Escape');
    }
    await ctx.close();
  });
}
