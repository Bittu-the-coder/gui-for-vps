import { expect, test } from '@playwright/test';
import { KEY, api, openApp, openGfv, vpsUp } from './helpers';

// M11 through the real UI, on both Docker servers: parameterize a recorded recipe, replay it on vps-b, hit a
// REAL failure and decide what to do, then broadcast one action to both servers.

test('replay a recipe on another server with a parameter, handle a failing step, then broadcast', async ({
  page,
}) => {
  test.setTimeout(180_000);
  test.skip(
    !((await vpsUp(2201)) && (await vpsUp(2202))),
    'both Docker test VPSes must be running',
  );
  await openGfv(page);
  const stamp = Date.now();
  const root = `/tmp/gfv-e2e-m11-${stamp}`;

  // --- a second server (vps-b) ---------------------------------------------------------------
  const servers = await api<{ id: string; name: string }[]>(page, 'GET', '/api/servers');
  const a = servers.find((s) => s.name === 'vps-a')!.id;
  let b = servers.find((s) => s.name === 'vps-b')?.id;
  if (!b) {
    b = (
      await api<{ id: string }>(page, 'POST', '/api/servers', {
        name: 'vps-b',
        host: '127.0.0.1',
        port: 2202,
        username: 'gfv',
        authType: 'key',
        privateKey: KEY,
      })
    ).id;
    const first = await api<{ fingerprint: string }>(page, 'POST', `/api/servers/${b}/connect`);
    await api(page, 'POST', `/api/servers/${b}/trust-host-key`, { fingerprint: first.fingerprint });
  }
  await api(page, 'POST', `/api/servers/${b}/connect`);

  // --- record a recipe on vps-a (through the API: recording itself is covered by spec 05) -----------
  const recName = `Site setup ${stamp}`;
  await api(page, 'POST', '/api/recording/start', { serverId: a, name: recName });
  const ran = await api<{ runId: string }>(page, 'POST', '/api/runs', {
    serverId: a,
    actionId: 'files.mkdir',
    params: { path: `${root}/seed` },
    confirmed: true,
  });
  expect(ran.runId).toBeTruthy();
  await expect
    .poll(
      async () =>
        (await api<{ active: { stepCount: number } | null }>(page, 'GET', '/api/recording')).active
          ?.stepCount,
    )
    .toBe(1);
  await api(page, 'POST', '/api/recording/stop');
  await page.reload();
  await expect(page.locator('[data-tour="server-switcher"]')).toBeVisible();

  // --- parameters, in the UI -------------------------------------------------------------------
  await openApp(page, 'recipes');
  await page.getByText(recName).click();
  await page.getByRole('button', { name: /^Parameters/ }).click();
  await page.getByRole('button', { name: 'Add parameter' }).click();
  await page.getByLabel('Parameter 1 name').fill('site');
  await page.getByLabel('Parameter 1 label').fill('Site name');
  await page.getByLabel('Parameter 1 default').fill('main');
  await page.getByRole('button', { name: 'Save parameters' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

  await page.getByRole('button', { name: 'Steps', exact: true }).click();
  await page.getByRole('button', { name: 'Edit step parameters' }).click();
  // An undeclared placeholder is refused with a clear message...
  await page
    .getByLabel(/Parameters of this step/)
    .fill(JSON.stringify({ path: `${root}/{{ghost}}` }));
  await page.getByRole('button', { name: 'Save step' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'ghost' })).toBeVisible();
  // ...the declared one is accepted, and the command shows where it goes.
  await page
    .getByLabel(/Parameters of this step/)
    .fill(JSON.stringify({ path: `${root}/site-{{site}}` }));
  await page.getByRole('button', { name: 'Save step' }).click();
  await expect(page.getByTestId('recipe-step')).toContainText(`${root}/site-{{site}}`);

  // --- replay it on vps-b -----------------------------------------------------------------------
  await page.getByRole('button', { name: 'Run on…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('vps-b')).toBeChecked(); // connected and not the server it was recorded on
  await dialog.getByLabel(/Site name/).fill('blue');
  await dialog.getByRole('button', { name: 'Preview' }).click();
  await expect(dialog.getByLabel('Plan')).toContainText(`${root}/site-blue`);
  await dialog.getByRole('button', { name: 'Start' }).click();

  const target = page.getByTestId('job-target');
  await expect(target).toHaveAttribute('data-status', 'done', { timeout: 30_000 }); // the Jobs app opened by itself
  const listing = await api<{ entries: { name: string }[] }>(
    page,
    'GET',
    `/api/servers/${b}/fs/list?path=${encodeURIComponent(root)}`,
  );
  expect(listing.entries.map((e) => e.name)).toContain('site-blue');

  // --- a step that really fails: the target pauses, the others would carry on ---------------------
  const failName = `Failing ${stamp}`;
  await api(page, 'POST', '/api/recording/start', { serverId: a, name: failName });
  await api(page, 'POST', '/api/runs', {
    serverId: a,
    actionId: 'files.mkdir',
    params: { path: `${root}/ok1` },
    confirmed: true,
  });
  await expect
    .poll(
      async () =>
        (await api<{ active: { stepCount: number } | null }>(page, 'GET', '/api/recording')).active
          ?.stepCount,
    )
    .toBe(1);
  await api(page, 'POST', '/api/runs', {
    serverId: a,
    actionId: 'files.mkdir',
    params: { path: `${root}/ok2` },
    confirmed: true,
  });
  await expect
    .poll(
      async () =>
        (await api<{ active: { stepCount: number } | null }>(page, 'GET', '/api/recording')).active
          ?.stepCount,
    )
    .toBe(2);
  await api(page, 'POST', '/api/recording/stop');
  const recipes = await api<{ id: string; name: string }[]>(page, 'GET', '/api/recipes');
  const rid = recipes.find((r) => r.name === failName)!.id;
  const detail = await api<{ steps: { id: string }[] }>(page, 'GET', `/api/recipes/${rid}`);
  // /proc does not allow new folders: this step fails for real.
  await api(page, 'PATCH', `/api/recipes/${rid}/steps/${detail.steps[0]!.id}`, {
    params: { path: '/proc/gfv-nope/x' },
  });

  await page.reload();
  await openApp(page, 'recipes');
  await page.getByText(failName).click();
  await page.getByRole('button', { name: 'Run on…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start' }).click();

  const paused = page.locator('[data-testid="job-target"][data-status="paused"]');
  await expect(paused).toBeVisible({ timeout: 30_000 });
  await expect(
    page
      .getByRole('status')
      .or(page.getByRole('alert'))
      .filter({ hasText: 'needs a decision' })
      .first(),
  ).toBeVisible(); // toast
  const alert = paused.getByRole('alert');
  await expect(alert).toContainText('failed on vps-b');
  const after = await api<{ entries: { name: string }[] }>(
    page,
    'GET',
    `/api/servers/${b}/fs/list?path=${encodeURIComponent(root)}`,
  );
  expect(after.entries.map((e) => e.name)).not.toContain('ok2'); // nothing ran past the failure
  await alert.getByRole('button', { name: 'Skip step' }).click();
  await expect(page.locator('[data-testid="job-target"][data-status="done"]').first()).toBeVisible({
    timeout: 30_000,
  });
  const finished = await api<{ entries: { name: string }[] }>(
    page,
    'GET',
    `/api/servers/${b}/fs/list?path=${encodeURIComponent(root)}`,
  );
  expect(finished.entries.map((e) => e.name)).toContain('ok2'); // the next step ran after "skip"

  // --- broadcast one action to both servers ----------------------------------------------------------
  await page.getByRole('button', { name: 'New broadcast…' }).click();
  const bc = page.getByRole('dialog');
  await bc.getByLabel('Action').selectOption({ label: 'Show uptime and load (safe)' });
  await expect(bc.getByLabel('vps-a')).toBeChecked();
  await expect(bc.getByLabel('vps-b')).toBeChecked();
  await bc.getByRole('button', { name: 'Preview' }).click();
  await expect(bc.getByLabel('Plan')).toContainText('uptime');
  await bc.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('job-row').first()).toContainText('Broadcast');
  await expect(page.locator('[data-testid="job-target"][data-status="done"]')).toHaveCount(2, {
    timeout: 30_000,
  });

  // --- clean up --------------------------------------------------------------------------------------
  for (const id of [a, b!]) {
    await api(page, 'POST', '/api/runs', {
      serverId: id,
      actionId: 'files.delete-path',
      params: { path: root },
      confirmed: true,
    });
  }
});
