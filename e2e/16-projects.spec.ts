import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { api, confirmRun, openApp, openGfv, vpsUp } from './helpers';

// M18 in the browser: deploy an app from a REAL git repository on vps-a, give it environment variables, run it as a
// service, see an update appear, redeploy, and remove it.
const sh = (cmd: string) =>
  execSync(`docker exec -u gfv gfv-vps-a bash -lc ${JSON.stringify(cmd)}`, {
    encoding: 'utf8',
  }).trim();

async function runAndWait(page: Page, serverId: string, actionId: string, params: object = {}) {
  const r = await api<{ runId: string }>(page, 'POST', '/api/runs', {
    serverId,
    actionId,
    params,
    confirmed: true,
  });
  await expect
    .poll(
      async () =>
        (
          await api<{ entries: { id: string; finishedAt: number | null }[] }>(
            page,
            'GET',
            '/api/history?limit=50',
          )
        ).entries.find((e) => e.id === r.runId)?.finishedAt,
      { timeout: 240_000 },
    )
    .toBeTruthy();
}

test('Projects: deploy from git, environment, service, update, redeploy, remove', async ({
  page,
}) => {
  test.setTimeout(420_000);
  test.skip(!(await vpsUp()), 'the Docker test VPS is not running');
  await openGfv(page);
  const a = (await api<{ id: string; name: string }[]>(page, 'GET', '/api/servers')).find(
    (s) => s.name === 'vps-a',
  )!.id;
  const stamp = Date.now();
  const name = `e2e-${stamp % 100000}`;
  const work = `/tmp/gfv-e2e-m18-${stamp}`;
  const repo = `${work}/app.git`;

  const hadGit = sh('command -v git || echo none') !== 'none';
  if (!hadGit) await runAndWait(page, a, 'devhub.install.git');
  sh(
    `mkdir -p ${work} && cd ${work} && git init -q --bare app.git && git clone -q app.git work 2>/dev/null && cd work && git config user.email t@t && git config user.name t && echo one > version.txt && git add -A && git commit -qm one && git branch -M main && git push -q origin main`,
  );

  await openApp(page, 'projects');
  await expect(page.getByText('No projects yet')).toBeVisible({ timeout: 20_000 });

  // --- new project: validation first, then the preview, then it deploys
  await page.getByRole('button', { name: 'New project' }).click();
  const dlg = page.getByRole('dialog', { name: 'New project' });
  await dlg.getByLabel('Name').fill(name);
  await dlg.getByLabel('Repository').fill('--upload-pack=touch /tmp/pwned');
  await dlg.getByRole('button', { name: 'Review…' }).click();
  await expect(dlg.getByRole('alert')).toContainText('Repository');
  await dlg.getByLabel('Repository').fill(repo);
  await dlg.getByLabel(/Build command/).fill('cp version.txt built.txt');
  await dlg.getByLabel(/Start command/).fill('sleep 1000');
  await dlg.getByRole('button', { name: 'Review…' }).click();
  await expect(page.getByText('clone --branch main --').first()).toBeVisible(); // the real command, before anything runs
  await confirmRun(page);
  const card = page.getByTestId('project-card').filter({ hasText: name });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('main @');
  expect(sh(`cat ~/gfv-projects/${name}/built.txt`)).toBe('one');

  // --- environment variable: saved with mode 600
  await card.getByRole('button', { name: 'Environment…' }).click();
  const env = page.getByRole('dialog', { name: `Environment for ${name}` });
  await env.getByLabel('Variable 1 name').fill('API_KEY');
  await env.getByLabel('Variable 1 value').fill('e2e-secret-value');
  await env.getByRole('button', { name: 'Review…' }).click();
  await confirmRun(page);
  await expect(card).toContainText('.env', { timeout: 20_000 });
  expect(sh(`stat -c %a ~/gfv-projects/${name}/.env`)).toBe('600');
  const history = JSON.stringify(await api(page, 'GET', '/api/history'));
  expect(history).not.toContain('e2e-secret-value');

  // --- run as a service (systemd itself is the test image's shim; the unit file is real)
  await card.getByRole('button', { name: 'Run as a service…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Review…' }).click(); // the start command was remembered
  await confirmRun(page);
  await expect(card.getByRole('button', { name: 'Restart' })).toBeVisible({ timeout: 20_000 });
  expect(sh(`cat /etc/systemd/system/gfv-${name}.service`)).toContain(
    'ExecStart=/bin/bash -lc "sleep 1000"',
  );

  // --- an update appears, and redeploying picks it up
  sh(
    `cd ${work}/work && echo two > version.txt && git add -A && git commit -qm two && git push -q origin main`,
  );
  await card.getByRole('button', { name: 'Check for updates' }).click();
  await expect(page.getByText('What this does')).toBeVisible();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByText(/Finished successfully/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Close' }).last().click();
  await expect(card).toContainText('1 new commit', { timeout: 20_000 });
  await card.getByRole('button', { name: 'Deploy', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Review…' }).click();
  await confirmRun(page);
  await expect(card).not.toContainText('new commit', { timeout: 20_000 });
  expect(sh(`cat ~/gfv-projects/${name}/built.txt`)).toBe('two');

  // --- remove (danger: needs the checkbox)
  await card.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Permanently deletes the project folder')).toBeVisible();
  await confirmRun(page);
  await expect(page.getByTestId('project-card').filter({ hasText: name })).toHaveCount(0, {
    timeout: 20_000,
  });
  expect(sh(`test -e ~/gfv-projects/${name} && echo left || echo gone`)).toBe('gone');

  sh(`rm -rf ${work}`);
  if (!hadGit) await runAndWait(page, a, 'devhub.uninstall.git'); // leave the server as we found it
});
