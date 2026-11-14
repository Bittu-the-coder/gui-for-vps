import { expect, test } from '@playwright/test';
import { KEY, api, gotoPath, openApp, openGfv, vpsUp } from './helpers';

// M22: drag a file from one server's Files window into another's.
test('drag a file from a vps-a window into a vps-b window, and a second drag is refused (no overwrite)', async ({
  page,
}) => {
  test.setTimeout(45_000);
  test.skip(
    !((await vpsUp(2201)) && (await vpsUp(2202))),
    'both Docker test VPSes must be running',
  );
  await openGfv(page);
  const stamp = Date.now();
  const dir = `/tmp/gfv-e2e-m22-${stamp}`;

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
  for (const id of [a, b])
    await api(page, 'POST', '/api/runs', {
      serverId: id,
      actionId: 'files.mkdir',
      params: { path: dir },
      confirmed: true,
    });
  // The runs return before they finish: wait until both folders really exist.
  for (const id of [a, b]) {
    await expect
      .poll(async () =>
        Array.isArray(
          (
            await api<{ entries?: unknown[] }>(
              page,
              'GET',
              `/api/servers/${id}/fs/list?path=${encodeURIComponent(dir)}`,
            )
          ).entries,
        ),
      )
      .toBe(true);
  }
  await page.evaluate(
    async ({ a, dir }) => {
      await fetch(
        `/api/servers/${a}/fs/file?path=${encodeURIComponent(`${dir}/hello.txt`)}&create=1`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream' },
          body: 'hello across servers\n',
        },
      );
    },
    { a, dir },
  );

  await page.evaluate(() => localStorage.removeItem('gfv.desktop.v1'));
  await page.reload();

  // Window 1: vps-a. Window 2: vps-b (switch the active server, then File > New Window).
  await openApp(page, 'files');
  await gotoPath(page, dir);
  await page.getByRole('button', { name: 'Active server' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'vps-b' }).click();
  await page.getByRole('button', { name: 'File menu' }).click();
  await page.getByRole('menuitem', { name: 'New Window' }).click();
  const wins = page.getByTestId('window');
  await expect(wins).toHaveCount(2);
  const win2 = wins.nth(1);
  await expect(win2).toContainText('vps-b');
  // (gotoPath is page-wide, and there are two Files windows now: scope to this one.)
  await win2.getByLabel('Path').fill(dir);
  await win2.getByLabel('Path').press('Enter');
  await expect(win2.locator(`[data-path="${dir}"]`)).toBeVisible();
  // Move window 2 to the right so both are visible. Wait for its open animation first (a drag during it can be lost),
  // and check that it really moved.
  await expect.poll(() => win2.evaluate((el) => el.getAnimations().length)).toBe(0);
  for (let attempt = 0; attempt < 3; attempt++) {
    const bar = win2.locator('.win-titlebar');
    const box = (await bar.boundingBox())!;
    if (box.x > 250) break;
    await page.mouse.move(box.x + 200, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 650, box.y + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  expect((await win2.locator('.win-titlebar').boundingBox())!.x).toBeGreaterThan(250);

  const win1 = wins.nth(0);
  const row = win1.getByTestId('file-row').filter({ hasText: 'hello.txt' });
  await expect(row).toBeVisible();
  // Grab the row at its left end (the middle is under the second window) and drop on the part of the second
  // window the first one does not cover: pressing on a row brings its window to the front.
  await row.dragTo(win2.locator('[data-path] > .overflow-auto'), {
    sourcePosition: { x: 40, y: 10 },
    targetPosition: { x: 680, y: 120 },
  });
  await expect(page.getByRole('status').filter({ hasText: 'Copied hello.txt' })).toBeVisible();
  await expect(win2.getByTestId('file-row').filter({ hasText: 'hello.txt' })).toBeVisible();
  const onB = await api<{ content: string }>(
    page,
    'GET',
    `/api/servers/${b}/fs/read?path=${encodeURIComponent(`${dir}/hello.txt`)}`,
  );
  expect(onB.content).toBe('hello across servers\n');

  // The same drag again must not overwrite.
  // Grab the row at its left end (the middle is under the second window) and drop on the part of the second
  // window the first one does not cover: pressing on a row brings its window to the front.
  await row.dragTo(win2.locator('[data-path] > .overflow-auto'), {
    sourcePosition: { x: 40, y: 10 },
    targetPosition: { x: 680, y: 120 },
  });
  await expect(
    page.getByRole('alert').filter({ hasText: 'Could not copy hello.txt' }),
  ).toBeVisible();

  for (const id of [a, b])
    await api(page, 'POST', '/api/runs', {
      serverId: id,
      actionId: 'files.delete-path',
      params: { path: dir },
      confirmed: true,
    });
});
