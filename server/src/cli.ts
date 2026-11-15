#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './start.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 4310;

const HELP = `GFV: a desktop in your browser for your VPS servers.

Usage: gfv [options]

  --port <n>    Port to listen on (default ${DEFAULT_PORT}; the next free one is used if it is busy)
  --no-open     Do not open the browser, just print the address
  --hosted      Hosted mode: sign in with accounts (and 2FA) instead of the local token, for running GFV on a
                server you reach from anywhere. Needs --public-url and a TLS proxy in front (see docs/HOSTED.md)
  --public-url <https://...>   The address people type, served by your TLS proxy (hosted mode)
  --host <addr>  Address to listen on in hosted mode (default 127.0.0.1: the proxy runs on the same machine)
  --version     Print the version
  --help        Show this help

Without --hosted, GFV only listens on 127.0.0.1 (this computer). Your data (servers, encrypted
credentials, history) lives in ~/.gfv, or in $GFV_HOME if set.`;

function version(): string {
  // dist-pkg/package.json when published, the repo's root package.json when run from source.
  for (const p of [resolve(HERE, '../package.json'), resolve(HERE, '../../package.json')]) {
    if (!existsSync(p)) continue;
    const pkg = JSON.parse(readFileSync(p, 'utf8')) as { name?: string; version: string };
    if (pkg.name === 'gfv') return pkg.version;
  }
  return '0.0.0';
}

/** Where the built web app is: next to dist/ when published, web/dist in the repo. */
function webDir(): string {
  const candidates = [
    process.env.GFV_WEB_DIR,
    resolve(HERE, '../web'),
    resolve(HERE, '../../web/dist'),
  ];
  return (
    candidates.find((p): p is string => !!p && existsSync(resolve(p, 'index.html'))) ??
    resolve(HERE, '../web')
  );
}

const free = (port: number) =>
  new Promise<boolean>((ok) => {
    const s = createServer();
    s.once('error', () => ok(false));
    s.listen(port, '127.0.0.1', () => s.close(() => ok(true)));
  });

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {}); // no browser available: the address is printed anyway
    child.unref();
  } catch {
    /* ignore */
  }
}

async function main() {
  process.env.GFV_LOG_LEVEL ??= 'warn'; // quiet terminal: just the address and real problems
  const args = process.argv.slice(2).filter((a) => a !== '--'); // `pnpm start -- --port 5000` passes a bare --
  if (args.includes('--help') || args.includes('-h')) return console.log(HELP);
  if (args.includes('--version') || args.includes('-v')) return console.log(version());

  const unknown = args.filter(
    (a, i) =>
      a.startsWith('-') &&
      !['--port', '--no-open', '--hosted', '--public-url', '--host'].includes(a) &&
      !['--port', '--public-url', '--host'].includes(args[i - 1] ?? ''),
  );
  if (unknown.length) {
    console.error(`Unknown option: ${unknown[0]}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }

  const portIdx = args.indexOf('--port');
  let port = DEFAULT_PORT;
  if (portIdx >= 0) {
    port = Number(args[portIdx + 1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error('--port needs a number between 1 and 65535');
      process.exitCode = 2;
      return;
    }
    if (!(await free(port))) {
      console.error(`Port ${port} is already in use. Pick another with --port.`);
      process.exitCode = 1;
      return;
    }
  } else {
    for (let i = 0; i < 20 && !(await free(port)); i++) port++;
  }

  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const hostedOn = args.includes('--hosted');
  const publicUrl = flag('--public-url');
  const host = flag('--host');
  if (hostedOn) {
    if (!publicUrl || !/^https:\/\/[^\s/]+(\/.*)?$/.test(publicUrl)) {
      console.error(
        'Hosted mode needs --public-url https://your.domain (the address your TLS proxy serves).',
      );
      process.exitCode = 2;
      return;
    }
  } else if (publicUrl || host) {
    console.error('--public-url and --host only make sense with --hosted.');
    process.exitCode = 2;
    return;
  }
  const setupToken = process.env.GFV_SETUP_TOKEN ?? randomBytes(18).toString('base64url');

  process.env.GFV_VERSION = version(); // reported by /api/health
  const server = await startServer({
    port,
    token: process.env.GFV_TOKEN ?? randomBytes(32).toString('hex'),
    webDir: webDir(),
    ...(hostedOn
      ? { hosted: { publicUrl: publicUrl!, ...(host ? { host } : {}), setupToken } }
      : {}),
  });
  if (hostedOn) {
    console.log(
      `GFV ${version()} (hosted mode) listens on ${host ?? '127.0.0.1'}:${port}, behind your proxy at ${server.url}`,
    );
    if (host && !['127.0.0.1', 'localhost', '::1'].includes(host))
      console.warn(
        `\nWARNING: listening on ${host} exposes GFV on that address. It only accepts sign-ins over HTTPS, but put a firewall or the proxy in front.`,
      );
    console.log(
      `\nFirst run? Create the administrator at ${server.url} with this setup token (shown only here):\n\n  ${setupToken}\n`,
    );
    console.log('Press Ctrl+C to stop.');
  } else {
    console.log(`GFV ${version()} is running. Open:\n\n  ${server.url}\n\nPress Ctrl+C to stop.`);
    if (!args.includes('--no-open')) openBrowser(server.url);
  }

  const stop = () => void server.close().finally(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
