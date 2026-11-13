// Starts GFV the way `npx gfv` does (built web app, cookie sign-in) on a fixed port, with an empty
// temporary data directory, for the Playwright specs.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

process.env.GFV_HOME = mkdtempSync(join(tmpdir(), 'gfv-e2e-'));
const { startServer } = await import('../server/src/start.js');
await startServer({
  port: 4399,
  token: 'e2e-token',
  webDir: resolve(import.meta.dirname, '../web/dist'),
});
