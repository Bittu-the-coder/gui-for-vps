import { expect, test } from '@playwright/test';
import { api, confirmRun, gotoPath, openApp, openGfv, vpsUp } from './helpers';

test('create a folder, upload a file, edit it in the editor and save', async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  const servers = await api<{ id: string }[]>(page, 'GET', '/api/servers');
  const sid = servers[0]!.id;
  const dir = `e2e-${Date.now()}`;

  await openApp(page, 'files');
  await gotoPath(page, '/tmp');
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByLabel('Name').fill(dir);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(`mkdir -p -- /tmp/${dir}`).first()).toBeVisible(); // Learn Mode: the real command
  await confirmRun(page);
  // The list refreshes after the run, which can replace the row between the two clicks of a double-click:
  // retry until the Files window has really moved into the new folder.
  await expect(async () => {
    await page.getByTestId('file-row').filter({ hasText: dir }).dblclick();
    await expect(page.locator(`[data-path="/tmp/${dir}"]`)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });

  await page.getByTestId('upload-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello from the browser\n'),
  });
  await expect(page.getByText('Uploaded 1 file.')).toBeVisible();

  await page.getByTestId('file-row').filter({ hasText: 'notes.txt' }).dblclick();
  await page.locator('.monaco-editor').waitFor({ timeout: 30_000 });
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('edited in the editor\n');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  const saved = await api<{ content: string }>(
    page,
    'GET',
    `/api/servers/${sid}/fs/read?path=${encodeURIComponent(`/tmp/${dir}/notes.txt`)}`,
  );
  expect(saved.content).toBe('hello from the browser\nedited in the editor\n');
  await api(page, 'POST', '/api/runs', {
    serverId: sid,
    actionId: 'files.delete-path',
    params: { path: `/tmp/${dir}` },
    confirmed: true,
  });
});
