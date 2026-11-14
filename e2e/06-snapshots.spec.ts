import { expect, test } from '@playwright/test';
import { api, confirmRun, gotoPath, openApp, openGfv, vpsUp } from './helpers';

test('a refused save can be redone with sudo, shows up in the timeline, and can be restored', async ({
  page,
}) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  const sid = (await api<{ id: string }[]>(page, 'GET', '/api/servers'))[0]!.id;
  const file = `/etc/gfv-e2e-${Date.now()}.conf`;

  // A root-owned file to edit (created through the same Command Runner action the editor uses).
  const tmp = `/tmp/gfv-save-${Math.random().toString(16).slice(2, 14)}`;
  await page.evaluate(
    async ({ sid, tmp }) => {
      await fetch(`/api/servers/${sid}/fs/file?path=${encodeURIComponent(tmp)}&create=1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: 'workers = 2\n',
      });
    },
    { sid, tmp },
  );
  const first = await api<{ runId: string }>(page, 'POST', '/api/runs', {
    serverId: sid,
    actionId: 'files.write-root',
    params: { path: file, tmp },
    confirmed: true,
  });
  expect(first.runId).toBeTruthy();
  await expect
    .poll(
      async () =>
        (
          await api<{ kind: string }>(
            page,
            'GET',
            `/api/servers/${sid}/fs/read?path=${encodeURIComponent(file)}`,
          )
        ).kind,
    )
    .toBe('text');

  // Edit it: the normal save is refused (needs root) and "Save with sudo…" appears.
  await openApp(page, 'files');
  await gotoPath(page, '/etc');
  await page.getByText(file.split('/').pop()!).dblclick();
  await page.locator('.monaco-editor').waitFor({ timeout: 30_000 });
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('workers = 8\n');
  await page.keyboard.press('Control+s');
  await page.getByRole('button', { name: 'Save with sudo…' }).click();
  await expect(page.getByText('.gfv/snapshots').first()).toBeVisible(); // the backup is part of the visible commands
  await confirmRun(page);
  await expect(page.getByText(/Saved with sudo/)).toBeVisible();

  // Timeline: one backup, holding the OLD content; restore brings it back.
  await openApp(page, 'snapshots');
  await page.getByTestId('snapshot-row').first().click();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Restore this version…' }).click();
  await confirmRun(page);
  const now = await api<{ content: string }>(
    page,
    'GET',
    `/api/servers/${sid}/fs/read?path=${encodeURIComponent(file)}`,
  );
  expect(now.content).toBe('workers = 2\n');
  await expect(page.getByText('Before a restore').first()).toBeVisible(); // the restore itself is undoable

  // Deleting a backup removes it from the timeline.
  const rows = page.getByTestId('snapshot-row');
  const before = await rows.count();
  await rows.first().click();
  await page.getByRole('button', { name: 'Delete backup' }).click();
  // A styled confirmation (not the browser's native one): Cancel has the focus, so Delete is a deliberate click.
  const sure = page.getByRole('alertdialog', { name: 'Delete this backup?' });
  await expect(sure.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await sure.getByRole('button', { name: 'Delete' }).click();
  await expect(rows).toHaveCount(before - 1);
});
