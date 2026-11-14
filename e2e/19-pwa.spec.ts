import { expect, test } from '@playwright/test';
import { openGfv } from './helpers';

// M26: GFV can be installed as an app. The manifest and icons are right, Chromium itself says the page is
// installable, the service worker caches only the built files, and it NEVER stores anything from /api.

const pngSize = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

test('the manifest and icons are public, valid and the right size', async ({
  browser,
  baseURL,
}) => {
  const ctx = await browser.newContext(); // no cookie: the browser fetches these before any sign-in
  const res = await ctx.request.get(`${baseURL}/manifest.webmanifest`);
  expect(res.status()).toBe(200);
  const m = await res.json();
  expect(m).toMatchObject({
    name: expect.any(String),
    start_url: '/',
    scope: '/',
    display: 'standalone',
  });
  const sizes = new Set<string>();
  for (const icon of m.icons as { src: string; sizes: string; type: string; purpose: string }[]) {
    const r = await ctx.request.get(`${baseURL}${icon.src}`);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()['content-type']).toContain('image/png');
    const { w, h } = pngSize(await r.body());
    expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
    sizes.add(`${icon.sizes}/${icon.purpose}`);
  }
  expect([...sizes]).toEqual(
    expect.arrayContaining(['192x192/any', '512x512/any', '512x512/maskable']),
  );
  // The service worker file must never be cached for long, or an update could not reach people.
  const sw = await ctx.request.get(`${baseURL}/sw.js`);
  expect(sw.status()).toBe(200);
  expect(sw.headers()['content-type']).toMatch(/javascript/);
  expect(sw.headers()['cache-control'] ?? '').toMatch(/max-age=0|no-cache|no-store/);
  await ctx.close();
});

test('Chromium considers GFV installable, and the service worker takes control', async ({
  page,
}) => {
  await openGfv(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // a worker controls the pages that load after it activated
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: { errorId: string }[];
  };
  // A test browser is a private ("incognito") profile, where Chromium never offers installing: not a GFV problem.
  expect(installabilityErrors.map((e) => e.errorId).filter((id) => id !== 'in-incognito')).toEqual(
    [],
  );
});

test('the service worker stores built files only: nothing from /api, ever', async ({ page }) => {
  await openGfv(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // Make API traffic go through the controlled page (data and an error), then look inside every cache.
  const vault = await page.evaluate(async () => (await fetch('/api/vault')).status);
  expect(vault).toBe(200);
  await page.evaluate(() => fetch('/api/servers').then((r) => r.text()));
  const stored = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys())
        urls.push(new URL(req.url).pathname);
    return urls;
  });
  expect(stored.length).toBeGreaterThan(0);
  for (const p of stored) expect(p, p).toMatch(/^\/(assets\/|offline\.html$)/);
});

test('with GFV stopped, the installed app shows a clear page instead of a browser error', async ({
  page,
  context,
}) => {
  await openGfv(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'GFV is not running' })).toBeVisible();
  await expect(page.getByText('npx gfv')).toBeVisible();
  await context.setOffline(false);
  await page.goto('/');
  await expect(page.locator('[data-tour="server-switcher"]')).toBeVisible();
});
