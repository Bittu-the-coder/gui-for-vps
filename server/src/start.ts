import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { sessionCookie, tokenMatches } from './auth.js';
import { UserService } from './services/auth/users.js';
import { Vault } from './crypto/vault.js';
import { openDb } from './db/index.js';
import { dbVaultStore } from './db/vaultStore.js';
import { AiGateway } from './services/ai/gateway.js';
import { DbService } from './services/dbgui/dbgui.js';
import { JobService } from './services/jobs/jobs.js';
import { RecipeService } from './services/recipes/recipes.js';
import { Runner } from './services/runner/runner.js';
import { SftpService } from './services/sftp/sftp.js';
import { dbHostKeyStore } from './ssh/hostKeys.js';
import { SshPool } from './ssh/pool.js';

export const HOST = '127.0.0.1'; // never 0.0.0.0: local mode only

export interface StartOptions {
  port: number;
  token: string;
  /** Built web app to serve (production). Omit in development: Vite serves the web app. */
  webDir?: string;
  /** Extra browser origin allowed to call the API (the Vite dev server). */
  devWebPort?: number;
  /**
   * Hosted mode (M24): accounts and sessions replace the local token. GFV listens on `host` (default 127.0.0.1) and
   * expects a TLS-terminating proxy in front, reachable at `publicUrl`.
   */
  hosted?: { publicUrl: string; host?: string; setupToken: string };
}

export interface RunningServer {
  app: FastifyInstance;
  /** Address to open in the browser; includes the one-time-per-session token. */
  url: string;
  close: () => Promise<void>;
}

/** Wires everything together and starts listening. Used by `pnpm dev` (index.ts) and `npx gfv` (cli.ts). */
export async function startServer(opts: StartOptions): Promise<RunningServer> {
  // Everything GFV writes (database, WAL files) is private to the current user.
  process.umask(0o077);
  const db = openDb();
  const vault = new Vault(dbVaultStore(db));
  const pool = new SshPool(db, vault, dbHostKeyStore(db));
  const runner = new Runner(db, pool);
  const recipes = new RecipeService(db);
  runner.onSuccess(recipes.recordRun); // successful recordable runs become recipe steps while recording

  // Replays and broadcasts: the same Command Runner, run across servers (a step never touches SSH directly).
  const jobs = new JobService(db, runner, recipes, (id) => pool.status(id) === 'connected');

  const sftp = new SftpService(pool, db);
  runner.onSnapshot((e) => void sftp.prune(e.serverId, e.path).catch(() => {}));

  const ports = [opts.port, ...(opts.devWebPort ? [opts.devWebPort] : [])];
  const allowedOrigins = ports.flatMap((p) => [`http://127.0.0.1:${p}`, `http://localhost:${p}`]);

  const publicOrigin = opts.hosted ? new URL(opts.hosted.publicUrl).origin : undefined;
  const app = await buildApp(opts.token, {
    ...(opts.hosted
      ? { hosted: { users: new UserService(db), setupToken: opts.hosted.setupToken } }
      : {}),
    db,
    vault,
    pool,
    runner,
    sftp,
    recipes,
    jobs,
    dbs: new DbService(db, vault, pool),
    ai: new AiGateway(db, vault),
    allowedOrigins: publicOrigin ? [publicOrigin, ...allowedOrigins] : allowedOrigins,
  });

  if (opts.webDir) {
    const index = join(opts.webDir, 'index.html');
    if (!existsSync(index)) throw new Error(`The web app was not found at ${opts.webDir}`);

    // Opening /?token=... once signs the browser in: set the cookie, then drop the token from the URL.
    // (Local mode only: hosted mode signs in with an account.)
    app.addHook('onRequest', async (req, reply) => {
      if (opts.hosted) return;
      const [path, query] = req.url.split('?');
      if (req.method !== 'GET' || path !== '/' || !query) return;
      const t = new URLSearchParams(query).get('token');
      if (t && tokenMatches(t, opts.token)) {
        return reply.header('set-cookie', sessionCookie(opts.token)).redirect('/', 302);
      }
    });
    await app.register(fastifyStatic, { root: opts.webDir });
    // Single-page app: unknown non-API paths show the app. Unknown API paths stay 404 JSON.
    app.setNotFoundHandler((req, reply) =>
      req.method === 'GET' && !req.url.startsWith('/api')
        ? reply.sendFile('index.html')
        : reply.code(404).send({ error: 'not_found' }),
    );
  }

  await app.listen({ host: opts.hosted?.host ?? HOST, port: opts.port });
  const close = async () => {
    pool.disconnectAll();
    await app.close();
  };
  const url = opts.hosted
    ? opts.hosted.publicUrl
    : `http://${HOST}:${opts.port}/?token=${opts.token}`;
  return { app, url, close };
}
