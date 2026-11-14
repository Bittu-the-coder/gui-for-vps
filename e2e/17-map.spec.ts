import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { auditContrast, prepare, settle } from './a11y';
import { KEY, api, openApp, openGfv, vpsUp } from './helpers';

// M19 in the browser, on REAL data from vps-b: nginx sites, a real listening program started from a project folder.
const sh = (cmd: string, user = 'gfv') =>
  execSync(`docker exec -u ${user} gfv-vps-b bash -lc ${JSON.stringify(cmd)}`, {
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

const LISTENER = [
  'use IO::Socket::INET;',
  '$s = IO::Socket::INET->new(LocalAddr => "127.0.0.1", LocalPort => 4571, Listen => 5, ReuseAddr => 1) or die;',
  'while ($c = $s->accept) { print $c "HTTP/1.0 200 OK\\r\\n\\r\\nok"; close $c }',
  '',
].join('\n');

test('Server Map: the path from a domain to its code, and the broken link in red', async ({
  page,
}) => {
  test.setTimeout(400_000);
  test.skip(
    !((await vpsUp(2201)) && (await vpsUp(2202))),
    'both Docker test VPSes must be running',
  );
  await openGfv(page);

  // vps-b as a server in GFV.
  const servers = await api<{ id: string; name: string }[]>(page, 'GET', '/api/servers');
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

  // Real things on vps-b: ss, nginx, a project folder with a listener started from it, two sites.
  for (let i = 0; i < 12 && sh('command -v ss || echo none') === 'none'; i++) {
    try {
      sh(
        'sudo apt-get update -q && sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -q -o DPkg::Lock::Timeout=120 iproute2 >/dev/null 2>&1',
      );
    } catch {
      /* apt is busy: retry */
    }
    await page.waitForTimeout(5000);
  }
  await runAndWait(page, b, 'devhub.install.nginx');
  writeFileSync('/tmp/gfv-e2e-map.pl', LISTENER);
  execSync('docker cp /tmp/gfv-e2e-map.pl gfv-vps-b:/tmp/gfv-e2e-map.pl');
  sh(
    '[ -f /tmp/gfv-e2e-map.pid ] && kill $(cat /tmp/gfv-e2e-map.pid) 2>/dev/null; mkdir -p ~/gfv-projects/mapdemo',
  );
  sh(
    `printf '%s' '{"name":"mapdemo","repo":"/x","branch":"main"}' > ~/gfv-projects/mapdemo/.gfv-project.json`,
  );
  sh(
    'cd ~/gfv-projects/mapdemo && (nohup perl /tmp/gfv-e2e-map.pl >/dev/null 2>&1 & echo $! > /tmp/gfv-e2e-map.pid); sleep 1',
  );
  await runAndWait(page, b, 'nginx.site.create', {
    kind: 'proxy',
    domain: 'map-live.test',
    port: 4571,
  });
  await runAndWait(page, b, 'nginx.site.create', {
    kind: 'proxy',
    domain: 'map-dead.test',
    port: 4998,
  });

  try {
    // Open the Map on vps-b (windows are tied to the active server).
    await page.reload();
    await page.getByRole('button', { name: 'Active server' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'vps-b' }).click();
    await openApp(page, 'map');
    const node = (kind: string, label: string) =>
      page.locator(`[data-testid="map-node"][data-kind="${kind}"][data-label="${label}"]`);

    // The healthy chain is all there.
    await expect(node('domain', 'map-live.test')).toBeVisible({ timeout: 30_000 });
    await expect(node('site', 'map-live.test')).toHaveAttribute('data-health', 'ok');
    await expect(node('port', ':4571')).toBeVisible();
    await expect(node('process', 'perl')).toBeVisible();
    await expect(node('project', 'mapdemo')).toBeVisible();

    // The dead site is red, its port says nothing is listening, and the problem is listed.
    await expect(node('site', 'map-dead.test')).toHaveAttribute('data-health', 'error');
    await expect(node('port', ':4998')).toContainText('nothing listening');
    const problem = page.getByTestId('map-problem').filter({ hasText: '4998' }).first();
    await expect(problem).toBeVisible();
    await expect(problem).toHaveAttribute('data-health', 'error');

    // Keyboard: Enter on the project box opens the Projects app.
    await node('project', 'mapdemo').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="window"][data-app="projects"]')).toBeVisible();

    // Contrast (WCAG AA) of the Map, the Network tabs and the Projects cards with REAL data, in both themes.
    // Reduce Transparency is on, so backgrounds are solid and the ratio is exact (see 10-accessibility).
    const failures: string[] = [];
    for (const theme of ['light', 'dark'] as const) {
      await prepare(page, theme);
      await page.getByRole('button', { name: 'Active server' }).click();
      await page.getByRole('menuitemcheckbox', { name: 'vps-b' }).click();
      const close = () =>
        page.getByTestId('window').last().getByRole('button', { name: 'Close' }).click();
      const check = async (name: string) => {
        await settle(page);
        for (const f of await auditContrast(page)) failures.push(`[${theme}] ${name}: ${f}`);
      };
      await openApp(page, 'map');
      await expect(node('site', 'map-dead.test')).toBeVisible({ timeout: 30_000 });
      await check('map');
      await close();
      await openApp(page, 'network');
      await expect(page.getByTestId('port-row').first()).toBeVisible({ timeout: 30_000 });
      await check('network: ports');
      await page.getByRole('tab', { name: /Sites/ }).click();
      await expect(page.getByText('map-dead.test').first()).toBeVisible();
      await check('network: sites');
      await page.getByRole('button', { name: /Add site/ }).click();
      await check('network: add site dialog');
      await page.keyboard.press('Escape');
      await close();
      await openApp(page, 'projects');
      await expect(page.getByText('mapdemo').first()).toBeVisible({ timeout: 30_000 });
      await check('projects');
      await close();
    }
    expect(failures, failures.join('\n')).toEqual([]);
  } finally {
    sh(
      '[ -f /tmp/gfv-e2e-map.pid ] && kill $(cat /tmp/gfv-e2e-map.pid) 2>/dev/null; rm -rf ~/gfv-projects/mapdemo /tmp/gfv-e2e-map.pl /tmp/gfv-e2e-map.pid; true',
    );
    await runAndWait(page, b, 'nginx.site.remove', { domain: 'map-live.test' });
    await runAndWait(page, b, 'nginx.site.remove', { domain: 'map-dead.test' });
  }
});
