import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * End-to-end specs: the built app (served the way `npx gfv` serves it) against the Docker test
 * VPS. Prepare once with:  docker compose -f e2e/docker-compose.yml up -d --build
 * `pnpm e2e` builds the web app first. If Playwright's own browser is not installed, either run
 * `pnpm exec playwright install chromium` or point GFV_CHROMIUM at any Chromium/Chrome binary.
 */
function findChromium(): string | undefined {
  if (process.env.GFV_CHROMIUM) return process.env.GFV_CHROMIUM;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cache)) return undefined;
  // Newest Chromium already on this machine (any Playwright-compatible build works for these specs).
  const dir = readdirSync(cache)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .at(-1);
  const exe = dir && join(cache, dir, 'chrome-linux64', 'chrome');
  return exe && existsSync(exe) ? exe : undefined;
}

export const PORT = 4399;
export const TOKEN = 'e2e-token';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  workers: 1, // the specs build on each other: one server, added in the first spec
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1400, height: 850 },
    launchOptions: { executablePath: findChromium() },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  outputDir: join(import.meta.dirname, '.results'),
  webServer: {
    // One process (no pnpm/tsx wrapper), so Playwright can stop it cleanly.
    // GFV_E2E_SERVER_CMD lets the same specs run against a packed `gfv` install instead (see README).
    command: process.env.GFV_E2E_SERVER_CMD ?? 'node --import tsx e2e/serve.ts',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    url: `http://127.0.0.1:${PORT}/`,
    timeout: 60_000,
    reuseExistingServer: false,
    cwd: join(import.meta.dirname, '..'),
  },
});
