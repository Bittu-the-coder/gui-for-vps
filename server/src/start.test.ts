import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from './start.js';

// Production mode: the built web app is served by the same server, and the browser signs in by
// opening /?token=... once (a cookie takes over).
describe('startServer in production mode', () => {
  const home = mkdtempSync(join(tmpdir(), 'gfv-home-'));
  const web = mkdtempSync(join(tmpdir(), 'gfv-web-'));
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>GFV</title><div id="root"></div>');
  writeFileSync(join(web, 'app.js'), 'console.log(1)');
  process.env.GFV_HOME = home;
  let srv: RunningServer;
  let base: string;
  const token = 'prod-token-abc';

  afterAll(async () => {
    await srv?.close();
  });

  it('starts on a free port and serves the app', async () => {
    // A real free port: the allowed browser origins are built from it.
    const port = await new Promise<number>((ok) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => ok(p));
      });
    });
    srv = await startServer({ port, token, webDir: web });
    base = `http://127.0.0.1:${port}`;
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root">');
    expect((await fetch(`${base}/app.js`)).status).toBe(200);
  });

  it('the data files are private to the user', async () => {
    const { statSync } = await import('node:fs');
    expect(statSync(join(home, 'gfv.db')).mode & 0o077).toBe(0);
  });

  it('/?token=... sets an HttpOnly SameSite=Strict cookie and redirects the token away', async () => {
    const r = await fetch(`${base}/?token=${token}`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/');
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toContain(`gfv_token=${token}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('a wrong token does not sign you in', async () => {
    const r = await fetch(`${base}/?token=wrong`, { redirect: 'manual' });
    expect(r.status).toBe(200); // just the app, no cookie
    expect(r.headers.get('set-cookie')).toBeNull();
  });

  it('the API needs the cookie; reads work with it', async () => {
    expect((await fetch(`${base}/api/vault`)).status).toBe(401);
    const ok = await fetch(`${base}/api/vault`, { headers: { cookie: `gfv_token=${token}` } });
    expect(ok.status).toBe(200);
  });

  it('cookie-authenticated changes must come from our own origin', async () => {
    const post = (origin?: string) =>
      fetch(`${base}/api/vault/create`, {
        method: 'POST',
        headers: {
          cookie: `gfv_token=${token}`,
          'content-type': 'application/json',
          ...(origin ? { origin } : {}),
        },
        body: JSON.stringify({ password: 'master-pass' }),
      });
    expect((await post('https://evil.example')).status).toBe(403);
    expect((await post()).status).toBe(403);
    expect((await post(base)).status).toBe(200);
  });

  it('unknown pages show the app (single-page app), unknown API paths stay JSON 404', async () => {
    const page = await fetch(`${base}/some/deep/link`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root">');
    const api = await fetch(`${base}/api/nope`, { headers: { cookie: `gfv_token=${token}` } });
    expect(api.status).toBe(404);
    expect(await api.json()).toEqual({ error: 'not_found' });
  });
});
