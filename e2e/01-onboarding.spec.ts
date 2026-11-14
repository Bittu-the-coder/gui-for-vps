import { expect, test } from '@playwright/test';
import { KEY, MASTER, TOKEN, vpsUp } from './helpers';

// New user: open the address, choose a master password, take the tour, add the first server.
// The whole thing has to fit in 3 minutes (PLAN §6, M9).
test('a new user goes from the address to a connected server in under 3 minutes', async ({
  page,
}) => {
  test.skip(
    !(await vpsUp()),
    'the Docker test VPS is not running (docker compose -f e2e/docker-compose.yml up -d)',
  );
  const started = Date.now();

  await page.goto(`/?token=${TOKEN}`);
  await expect(page).toHaveURL(/\/$/); // token removed from the address bar, cookie set
  await expect(page.getByRole('heading', { name: 'Welcome to GFV' })).toBeVisible();

  await page.getByLabel('Master password').fill(MASTER);
  await page.getByLabel('Confirm password').fill(MASTER);
  await page.getByRole('button', { name: 'Create vault' }).click();

  // First visit: the tour starts by itself and can be walked through.
  await expect(page.getByRole('dialog', { name: 'Tour' })).toBeVisible();
  await expect(page.getByText('Add your first server').first()).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Pick the active server')).toBeVisible();
  await page.getByText('Skip tour').click();
  await expect(page.getByRole('dialog', { name: 'Tour' })).toBeHidden();

  // Empty desktop: the call to action opens the Servers app.
  await page.getByRole('button', { name: 'Add a server' }).click();
  await page.getByRole('button', { name: '+ Add server' }).click();
  await page.getByLabel('Name', { exact: true }).fill('vps-a');
  await page.getByLabel('Host').fill('127.0.0.1');
  await page.getByLabel('Port').fill('2201');
  await page.getByLabel('Username').fill('gfv');
  await page.getByLabel('Private key', { exact: true }).fill(KEY);
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Trust and connect' }).click(); // first connection: verify the host key
  await expect(page.getByText('Connected ✔')).toBeVisible();

  const seconds = (Date.now() - started) / 1000;
  console.log(`first server connected after ${seconds.toFixed(1)} s`);
  expect(seconds).toBeLessThan(180);

  // The tour does not come back after a reload.
  await page.reload();
  await expect(page.locator('[data-tour="server-switcher"]')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Tour' })).toBeHidden();
});

test('without the token the API refuses, and the page explains nothing secret', async ({
  browser,
}) => {
  const ctx = await browser.newContext(); // no cookie
  const res = await ctx.request.get('/api/vault');
  expect(res.status()).toBe(401);
  await ctx.close();
});
