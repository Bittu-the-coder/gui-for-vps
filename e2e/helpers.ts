import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

export const TOKEN = 'e2e-token';
export const MASTER = 'e2e-master-pass';
export const KEY = readFileSync(join(import.meta.dirname, 'keys', 'id_test'), 'utf8');

/** Is the Docker test VPS up? The specs skip (loudly) when it is not. */
export const vpsUp = (port = 2201) =>
  new Promise<boolean>((ok) => {
    const s = connect(port, '127.0.0.1');
    s.setTimeout(1500, () => (s.destroy(), ok(false)));
    s.on('connect', () => (s.end(), ok(true)));
    s.on('error', () => ok(false));
  });

/** Sign in the way a user does: open the address `npx gfv` prints (the token becomes a cookie). */
export async function openGfv(page: Page): Promise<void> {
  await page.goto(`/?token=${TOKEN}`);
  await expect(page).toHaveURL(/\/$/); // the token is gone from the address bar
  // Either the unlock screen (after a server restart) or the desktop.
  const desktop = page.locator('[data-tour="server-switcher"]');
  const unlock = page.getByRole('button', { name: 'Unlock' });
  await expect(desktop.or(unlock)).toBeVisible();
  if (await unlock.isVisible()) {
    await page.getByLabel('Master password').fill(MASTER);
    await unlock.click();
    await expect(desktop).toBeVisible();
  }
  // The first-run tour (if it is showing) is not what these specs are about.
  const skip = page.getByRole('button', { name: 'Skip tour' }).or(page.getByText('Skip tour'));
  if (
    await skip
      .first()
      .isVisible()
      .catch(() => false)
  )
    await skip.first().click();
}

/**
 * Open an app by clicking its Dock icon (`id` is the app id: terminal, files, monitor, devhub...).
 *
 * The Dock magnifies icons under the pointer and pushes their neighbours aside (like macOS), so an icon's
 * position depends on where the pointer is. A test pointer that teleports from one icon to the next would
 * aim at the old, displaced position and land on a neighbour. Parking the pointer off the Dock first
 * restores the resting layout, where the aim is exact.
 */
export async function openApp(page: Page, id: string): Promise<void> {
  await page.mouse.move(5, 300);
  await page.locator(`[data-tour="app-${id}"]`).click();
}

/** Run a Command Runner action through the real dialog: preview, confirm if needed, wait for the result. */
export async function confirmRun(page: Page): Promise<void> {
  await page.getByText('What this does').waitFor();
  const risk = page.getByLabel('I understand the risk');
  if (await risk.isVisible()) {
    await risk.check();
    await page.getByRole('button', { name: 'Run anyway' }).click();
  } else {
    await page.getByRole('button', { name: 'Run', exact: true }).click();
  }
  await expect(page.getByText(/Finished successfully/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Close' }).last().click();
}

/** Call the GFV API from the page (the cookie is already set). */
export const api = <T = unknown>(page: Page, method: string, url: string, body?: unknown) =>
  page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return (await r.json().catch(() => ({}))) as T;
    },
    { method, url, body },
  );

/** In the Files window: go to a folder and wait until it has really been loaded (the window tracks its path). */
export async function gotoPath(page: Page, path: string): Promise<void> {
  await page.getByLabel('Path').fill(path);
  await page.getByLabel('Path').press('Enter');
  await expect(page.locator(`[data-path="${path}"]`)).toBeVisible();
}
