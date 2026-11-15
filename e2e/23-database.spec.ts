import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { auditContrast, prepare, settle } from './a11y';
import { KEY, api, openApp, openGfv, vpsUp } from './helpers';

// M21 in the browser: a REAL PostgreSQL (Docker on the real-systemd server) reached through an SSH tunnel.
const box = (cmd: string) =>
  execFileSync('docker', ['exec', 'gfv-vps-systemd', 'sh', '-c', cmd], { encoding: 'utf8' }).trim();
const dockerReady = () => {
  try {
    return box('docker info >/dev/null 2>&1 && echo yes') === 'yes';
  } catch {
    return false;
  }
};
const CLEAN = 'docker rm -f gfv-e2e-pg >/dev/null 2>&1; true';
const startPg = async () => {
  box(CLEAN);
  box(
    'docker run -d --name gfv-e2e-pg -e POSTGRES_PASSWORD=e2e-secret-pw -p 127.0.0.1:15434:5432 postgres:16-alpine >/dev/null',
  );
  for (
    let i = 0;
    i < 40 &&
    !box('docker exec gfv-e2e-pg pg_isready -U postgres 2>&1 || true').includes('accepting');
    i++
  )
    await new Promise((r) => setTimeout(r, 1500));
  // The first "accepting" can be the init phase: wait for the real server.
  await new Promise((r) => setTimeout(r, 3000));
};

async function useSystemdServer(page: Page) {
  const servers = await api<{ id: string; name: string }[]>(page, 'GET', '/api/servers');
  let id = servers.find((s) => s.name === 'systemd')?.id;
  if (!id) {
    id = (
      await api<{ id: string }>(page, 'POST', '/api/servers', {
        name: 'systemd',
        host: '127.0.0.1',
        port: 2204,
        username: 'gfv',
        authType: 'key',
        privateKey: KEY,
      })
    ).id;
    const first = await api<{ fingerprint: string }>(page, 'POST', `/api/servers/${id}/connect`);
    await api(page, 'POST', `/api/servers/${id}/trust-host-key`, {
      fingerprint: first.fingerprint,
    });
  }
  await api(page, 'POST', `/api/servers/${id}/connect`);
  await page.reload();
  await page.getByRole('button', { name: 'Active server' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'systemd' }).click();
  return id;
}

/** Saved connections survive between specs (they live in GFV's database): start each test from none. */
async function forgetConnections(page: Page, serverId: string) {
  const list = await api<{ id: string }[]>(page, 'GET', `/api/servers/${serverId}/db`);
  for (const c of list) await api(page, 'DELETE', `/api/db/${c.id}`);
}

async function addConnection(page: Page) {
  await page.getByRole('button', { name: 'New connection' }).click();
  await page.getByLabel('Name').fill('e2e db');
  await page.getByLabel('Port').fill('15434');
  await page.getByLabel('Password').fill('e2e-secret-pw');
  await page.getByRole('button', { name: 'Save' }).click();
}

test('Database: connect through the tunnel, browse, query, and the database refuses changes until you allow them', async ({
  page,
}) => {
  test.setTimeout(300_000);
  test.skip(
    !(await vpsUp(2204)) || !dockerReady(),
    'the systemd test server with Docker is not running',
  );
  await startPg();
  await openGfv(page);
  await forgetConnections(page, await useSystemdServer(page));
  try {
    await openApp(page, 'database');
    await addConnection(page);
    await expect(page.getByLabel('Connection', { exact: true })).toContainText('e2e db', {
      timeout: 20_000,
    });

    // A plain read.
    await page.getByLabel('SQL').fill("select 6*7 as answer, 'ok' as status");
    await page.getByRole('button', { name: /^Run/ }).click();
    await expect(page.getByTestId('db-grid')).toContainText('42', { timeout: 30_000 });

    // A change is refused by the database itself when "Allow changes" is off.
    await page.getByLabel('SQL').fill('create table pets (id serial primary key, name text)');
    await expect(page.getByTestId('write-hint')).toBeVisible();
    await page.getByRole('button', { name: /^Run/ }).click();
    await expect(page.getByTestId('db-error')).toContainText('allow changes');
    expect(
      box(
        'docker exec gfv-e2e-pg psql -U postgres -tAc "select count(*) from information_schema.tables where table_name=\'pets\'"',
      ),
    ).toBe('0');

    // With the switch on, a confirmation is asked, then it is committed and the table appears.
    await page.getByLabel('Allow changes').check();
    await page.getByRole('button', { name: /^Run/ }).click();
    await page.getByRole('button', { name: 'Run and commit' }).click();
    await expect(page.getByTestId('db-command')).toContainText('CREATE', { timeout: 30_000 });
    await expect(page.getByTestId('db-table').filter({ hasText: 'pets' })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByLabel('SQL').fill("insert into pets (name) values ('Rex'), ('Tilly')");
    await page.getByRole('button', { name: /^Run/ }).click();
    await page.getByRole('button', { name: 'Run and commit' }).click();
    await expect(page.getByTestId('db-command')).toContainText('2 rows', { timeout: 30_000 });
    await page.getByLabel('Allow changes').uncheck();

    // Browse the table and export it.
    await page.getByTestId('db-table').filter({ hasText: 'pets' }).click();
    await expect(page.getByTestId('db-grid')).toContainText('Tilly', { timeout: 20_000 });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('pets.csv');
  } finally {
    box(CLEAN);
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`Database app contrast with real data (${theme})`, async ({ page }) => {
    test.setTimeout(240_000);
    test.skip(
      !(await vpsUp(2204)) || !dockerReady(),
      'the systemd test server with Docker is not running',
    );
    await startPg();
    try {
      await prepare(page, theme);
      await forgetConnections(page, await useSystemdServer(page));
      await openApp(page, 'database');
      await addConnection(page);
      await page.getByLabel('SQL').fill('select generate_series(1,5) as n, null as missing');
      await page.getByRole('button', { name: /^Run/ }).click();
      await expect(page.getByTestId('db-grid')).toContainText('NULL', { timeout: 30_000 });
      await settle(page);
      if (process.env.SHOT_DIR)
        await page.screenshot({ path: `${process.env.SHOT_DIR}/database-${theme}.png` });
      const failures = (await auditContrast(page)).map((f) => `[${theme}] database: ${f}`);
      expect(failures, failures.join('\n')).toEqual([]);
    } finally {
      box(CLEAN);
    }
  });
}
