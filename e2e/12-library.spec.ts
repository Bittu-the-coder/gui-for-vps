import { expect, test } from '@playwright/test';
import { openApp, openGfv, vpsUp } from './helpers';

// M12 in the browser: starter library, exports in four formats, sharing, importing an untrusted file, cloning a server.

test.beforeEach(async ({ page }) => {
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
});

test('add a starter recipe, export it in every format, share it, and import a file safely', async ({
  page,
}) => {
  await openApp(page, 'recipes');
  await page.getByRole('button', { name: 'Library…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Recipe library' });
  const entry = dialog.getByTestId('library-entry').filter({ hasText: 'Python + PostgreSQL' });
  await entry.locator('summary').click();
  await expect(entry).toContainText('apt-get'); // you can read the real commands before adding it
  await entry.getByRole('button', { name: 'Add' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Added “Python + PostgreSQL”' }),
  ).toBeVisible();
  await expect(page.getByTestId('recipe-step')).toHaveCount(2);

  // --- exports
  await page.getByRole('button', { name: 'Script', exact: true }).click();
  const view = page.getByTestId('script-view');
  await expect(view).toContainText('#!/usr/bin/env bash');
  const format = page.getByLabel('Export format');
  await format.selectOption({ label: 'Dockerfile' });
  await expect(view).toContainText('FROM ubuntu:24.04');
  await expect(view).toContainText('RUN ');
  await format.selectOption({ label: 'Ansible playbook' });
  await expect(view).toContainText('ansible.builtin.shell');
  await expect(page.getByLabel('Notes about this export')).toContainText(
    'no matching Ansible module',
  );
  await format.selectOption({ label: 'Docker Compose' });
  await expect(view).toContainText('services:');
  await page.getByRole('tab', { name: 'Dockerfile' }).click();
  await expect(view).toContainText('FROM ubuntu:24.04');

  // --- share: a downloadable, readable file
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Share' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Python-PostgreSQL.gfv-recipe.json');
  const body = JSON.parse(
    await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8'),
  );
  expect(body).toMatchObject({ format: 1, name: 'Python + PostgreSQL' });
  expect(body.steps.map((s: { actionId: string }) => s.actionId)).toEqual([
    'devhub.install.python',
    'devhub.install.postgresql',
  ]);

  // --- import: an untrusted file is shown in full, bad ones are refused with reasons
  await page.getByRole('button', { name: 'Library…' }).click();
  const lib = page.getByRole('dialog', { name: 'Recipe library' });
  await lib.getByRole('tab', { name: 'From a file' }).click();
  const box = lib.getByPlaceholder(/"format": 1/);
  await box.fill('{"format":1,"name":"Evil","steps":[{"actionId":"rm.everything","params":{}}]}');
  await expect(lib.getByRole('alert')).toContainText('does not exist');
  await expect(lib.getByRole('button', { name: 'Import' })).toBeDisabled();

  const good = {
    format: 1,
    name: 'Imported site',
    params: [{ name: 'site', label: 'Site', default: 'main' }],
    steps: [{ actionId: 'files.mkdir', params: { path: '/var/www/{{site}}' } }],
  };
  await box.fill(JSON.stringify(good));
  const preview = lib.getByLabel('File preview');
  await expect(preview).toContainText('Unreviewed');
  await expect(preview).toContainText('/var/www/{{site}}');
  await lib.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByTestId('recipe-step')).toContainText('/var/www/{{site}}');
  await page.getByRole('button', { name: /^Parameters/ }).click();
  await expect(page.getByLabel('Parameter 1 default')).toHaveValue('main');
});

test('Clone setup turns what is installed on a server into a recipe', async ({ page }) => {
  await openApp(page, 'servers');
  const row = page.getByText('vps-a').first();
  await expect(row).toBeVisible();
  const clone = page.getByRole('button', { name: 'Clone setup' }).first();
  await expect(clone).toBeEnabled();
  await clone.click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Created a recipe from vps-a' }),
  ).toBeVisible();
  await expect(page.getByTestId('recipe-step').first()).toContainText(/Install/);
});
