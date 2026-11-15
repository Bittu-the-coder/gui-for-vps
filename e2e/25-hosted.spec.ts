import { expect, test, type Page } from '@playwright/test';
import { totpCode } from '../server/src/crypto/totp';
import { auditContrast, settle } from './a11y';
import { KEY, MASTER, vpsUp } from './helpers';

// M24 in the browser, against a GFV started in HOSTED mode (its own server and data directory on port 4398).
test.use({ baseURL: 'http://127.0.0.1:4398' });
test.describe.configure({ mode: 'serial' });

const SETUP_TOKEN = 'e2e-setup-token-123456';
const ADMIN_PW = 'admin passphrase 123';
const ANN_PW = 'ann passphrase 12345';

const call = <T = unknown>(page: Page, method: string, url: string, body?: unknown) =>
  page.evaluate(
    async ({ method, url, body }) => {
      const r = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, json: (await r.json().catch(() => ({}))) as T };
    },
    { method, url, body },
  );

/** The first-run tour appears once per browser: dismiss it so it does not cover the desktop. */
async function dismissTour(page: Page) {
  await expect(page.locator('[data-tour="server-switcher"]')).toBeVisible({ timeout: 20_000 });
  const skip = page.getByText('Skip tour');
  if (
    await skip
      .first()
      .isVisible()
      .catch(() => false)
  )
    await skip.first().click();
}

async function signIn(page: Page, user: string, pw: string, code?: string) {
  await page.goto('/');
  await page.getByLabel('Username').fill(user);
  await page.getByLabel(/^Password/).fill(pw);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (code) {
    await page.getByLabel(/Code from your authenticator/).fill(code);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
}

let secret = '';
let recovery: string[] = [];

test('first run: the setup token creates the administrator, then the master password, then the desktop', async ({
  page,
}) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to GFV' })).toBeVisible();
  // Nothing of the app is reachable before signing in.
  expect((await call(page, 'GET', '/api/servers')).status).toBe(401);

  await page.getByLabel('Setup token').fill('this is not the token');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel(/^Password/).fill(ADMIN_PW);
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await expect(page.getByRole('alert')).toContainText('not the setup token');
  await page.getByLabel('Setup token').fill(SETUP_TOKEN);
  await page.getByRole('button', { name: 'Create administrator' }).click();

  // The vault (master password) is the next step, for the administrator.
  await page.getByLabel('Master password').fill(MASTER);
  await page.getByLabel('Confirm password').fill(MASTER);
  await page.getByRole('button', { name: 'Create vault' }).click();
  await expect(page.locator('[data-tour="server-switcher"]')).toBeVisible();
  const skip = page.getByText('Skip tour');
  if (
    await skip
      .first()
      .isVisible()
      .catch(() => false)
  )
    await skip.first().click();
  await expect(page.locator('[data-tour="app-users"]')).toBeVisible(); // administrators get the Users app
});

test('turn on two-factor authentication with a real authenticator code, then sign out and in again', async ({
  page,
}) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await signIn(page, 'admin', ADMIN_PW);
  await dismissTour(page);
  await page.getByRole('button', { name: 'Control Center' }).click();
  await page.getByRole('button', { name: 'Account…' }).click();
  await page.getByRole('button', { name: 'Set up 2FA' }).click();
  secret = (await page.getByTestId('totp-secret').innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel('6-digit code').fill('000000');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('account-error')).toBeVisible(); // a wrong code is refused
  await page.getByLabel('6-digit code').fill(totpCode(secret));
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('recovery-codes')).toContainText('Save these recovery codes');
  recovery =
    (await page.getByTestId('recovery-codes').innerText()).match(/[0-9a-f]{5}-[0-9a-f]{5}/g) ?? [];
  expect(recovery).toHaveLength(8);
  await page.getByRole('button', { name: 'I saved them' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out' }).last().click(); // the footer one (earlier ones sign out other devices)
  await expect(page.getByRole('heading', { name: 'Sign in to GFV' })).toBeVisible();

  // Password alone is not enough any more; the code must be a NEW one (the used step cannot be replayed).
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel(/^Password/).fill(ADMIN_PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel(/Code from your authenticator/)).toBeVisible();
  await page.getByLabel(/Code from your authenticator/).fill(totpCode(secret, Date.now() + 30_000));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await dismissTour(page);
});

test('an administrator creates a member who may use only one server; the member cannot reach the rest', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  // The authenticator code of this moment was just used, so the administrator signs in with a recovery code (works once).
  await signIn(page, 'admin', ADMIN_PW, recovery[0]);
  await dismissTour(page);
  // Two servers (the real test VPS, twice under different names), created through the API as the administrator.
  const mk = async (name: string) =>
    (
      await call<{ id: string }>(page, 'POST', '/api/servers', {
        name,
        host: '127.0.0.1',
        port: 2201,
        username: 'gfv',
        authType: 'key',
        privateKey: KEY,
      })
    ).json.id;
  const open = await mk('open-server');
  const secretServer = await mk('secret-server');
  await page.reload(); // the desktop learns about servers created behind its back
  await dismissTour(page);

  await page.locator('[data-tour="app-users"]').click();
  await page.getByLabel('New account: username').fill('ann');
  await page.getByLabel(/^Password \(12\+/).fill(ANN_PW);
  await page.getByRole('button', { name: 'Create' }).click();
  const row = page.locator('[data-testid="user-row"][data-user="ann"]');
  await expect(row).toBeVisible();
  await row.getByLabel('open-server').click(); // updates after the server confirms: not check(), which expects an instant change
  await expect(row.getByLabel('open-server')).toBeChecked();
  await settle(page);
  const failures = await auditContrast(page);
  expect(failures, failures.join('\n')).toEqual([]);

  // The audit log recorded it, without the password.
  await page.getByRole('tab', { name: 'Audit log' }).click();
  await expect(page.getByTestId('audit-table')).toContainText('user.create');
  await expect(page.getByTestId('audit-table')).toContainText('user.access');
  expect(await page.getByTestId('audit-table').innerText()).not.toContain(ANN_PW);

  // Ann, in a fresh browser context.
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:4398' });
  const ann = await ctx.newPage();
  await signIn(ann, 'ann', ANN_PW);
  await expect(ann.locator('[data-tour="server-switcher"]')).toBeVisible({ timeout: 20_000 });
  const skip = ann.getByText('Skip tour');
  if (
    await skip
      .first()
      .isVisible()
      .catch(() => false)
  )
    await skip.first().click();
  await expect(ann.locator('[data-tour="app-users"]')).toHaveCount(0); // no Users app for members
  const servers = (await call<{ name: string }[]>(ann, 'GET', '/api/servers')).json;
  expect(servers.map((s) => s.name)).toEqual(['open-server']);
  // Direct API calls are refused, whatever the UI shows.
  expect((await call(ann, 'GET', '/api/users')).status).toBe(403);
  expect((await call(ann, 'GET', '/api/audit')).status).toBe(403);
  expect(
    (
      await call(ann, 'POST', '/api/runs/preview', {
        serverId: secretServer,
        actionId: 'system.uptime',
      })
    ).status,
  ).toBe(403);
  expect((await call(ann, 'GET', `/api/servers/${secretServer}/fs/list?path=/`)).status).toBe(403);
  expect(
    (await call(ann, 'POST', '/api/runs/preview', { serverId: open, actionId: 'system.uptime' }))
      .status,
  ).toBe(200);
  await ann.getByRole('button', { name: 'Control Center' }).click();
  await expect(ann.getByTestId('cc-account')).toContainText('member');
  await ctx.close();

  // Disabling the account ends its sessions at once and blocks new sign-ins.
  await page.getByRole('tab', { name: 'Accounts' }).click();
  await row.getByRole('button', { name: 'Disable' }).click();
  await expect(row).toContainText('disabled');
  const ctx2 = await browser.newContext({ baseURL: 'http://127.0.0.1:4398' });
  const again = await ctx2.newPage();
  await signIn(again, 'ann', ANN_PW);
  await expect(again.getByRole('alert')).toContainText('Wrong username or password');
  await ctx2.close();
});
