import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SessionUser } from '@gfv/shared';
import type { AppContext } from './context.js';
import { dbConnections } from './db/schema.js';
import { eq } from 'drizzle-orm';
import type { UserService } from './services/auth/users.js';

/** Hosted mode (M24): sessions instead of the local token, roles, per-server access (deny by default), audit. */
export interface HostedContext {
  users: UserService;
  /** Printed on the server console at start; needed once, to create the first administrator. */
  setupToken: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    routeTable: { method: string; url: string }[];
  }
  interface FastifyRequest {
    /** The signed-in account (hosted mode). Undefined in local mode. */
    user?: SessionUser;
    sessionId?: string;
    /** Servers this request may touch: every one (local mode, administrators) or just these ids. */
    accessible: string[] | 'all';
  }
}

export const SESSION_COOKIE = 'gfv_session';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const cookieValue = (header: string | undefined, name: string): string | undefined =>
  header
    ?.split(';')
    .map((p) => p.trim().split('='))
    .find(([k]) => k === name)?.[1];

export const sessionCookieHeader = (token: string, maxAgeSec: number, secure: boolean): string =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
export const clearSessionCookie = (secure: boolean): string =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;

export const safeEqual = (a: string, b: string): boolean => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

/** Plain HTTP is only acceptable for this computer itself (development): credentials must not cross a network in clear. */
export function isSecureEnough(req: FastifyRequest): boolean {
  if (req.protocol === 'https') return true;
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

// ---- who may call what ------------------------------------------------------------------------------------------------

type Extractor = (req: FastifyRequest, ctx: AppContext) => string[] | null;
const fromParam =
  (name: string): Extractor =>
  (req) => {
    const v = (req.params as Record<string, string | undefined>)?.[name];
    return v ? [v] : null;
  };
const fromBody =
  (...paths: string[][]): Extractor =>
  (req) => {
    const ids: string[] = [];
    for (const path of paths) {
      let v: unknown = req.body;
      for (const k of path) v = (v as Record<string, unknown> | undefined)?.[k];
      if (typeof v !== 'string' || !v) return null; // a missing server id is not "no server": deny
      ids.push(v);
    }
    return ids;
  };
const fromDbConnection: Extractor = (req, ctx) => {
  const id = (req.params as { connId?: string }).connId;
  const row = id
    ? ctx.db.select().from(dbConnections).where(eq(dbConnections.id, id)).get()
    : undefined;
  return row ? [row.serverId] : null;
};
const fromRun: Extractor = (req, ctx) => {
  const run = ctx.runner.get((req.params as { id?: string }).id ?? '');
  return run ? [run.serverId] : null;
};

/**
 * What a MEMBER may call. Anything NOT listed here is administrator-only: a new route is closed to members until
 * someone decides, here, that it is safe. `server` = the ids to check against the member's access list; `anyone` =
 * every signed-in user (the handler filters what it returns); `public` = no sign-in.
 */
export interface Rule {
  public?: boolean;
  anyone?: boolean;
  server?: Extractor;
}

export const MEMBER_RULES: Record<string, Rule> = {
  'GET /api/health': { public: true },
  'GET /api/auth/status': { public: true },
  'POST /api/auth/login': { public: true },
  'POST /api/auth/setup': { public: true },
  // Own account.
  'POST /api/auth/logout': { anyone: true },
  'POST /api/auth/password': { anyone: true },
  'POST /api/auth/2fa/begin': { anyone: true },
  'POST /api/auth/2fa/confirm': { anyone: true },
  'POST /api/auth/2fa/disable': { anyone: true },
  'GET /api/auth/sessions': { anyone: true },
  'DELETE /api/auth/sessions/:id': { anyone: true },
  // Read-only facts; handlers filter by access.
  'GET /api/vault': { anyone: true },
  'GET /api/actions': { anyone: true },
  'GET /api/servers': { anyone: true },
  'GET /api/connections': { anyone: true },
  'GET /api/ws': { anyone: true },
  'GET /api/history': { anyone: true },
  'GET /api/ai/settings': { anyone: true },
  'POST /api/ai/prepare': { anyone: true },
  'POST /api/ai/send': { anyone: true },
  // Using a server they were given.
  'POST /api/servers/:id/connect': { server: fromParam('id') },
  'POST /api/servers/:id/disconnect': { server: fromParam('id') },
  'POST /api/servers/:id/test': { server: fromParam('id') },
  'GET /api/servers/:id/fs/list': { server: fromParam('id') },
  'GET /api/servers/:id/fs/read': { server: fromParam('id') },
  'GET /api/servers/:id/fs/download': { server: fromParam('id') },
  'PUT /api/servers/:id/fs/file': { server: fromParam('id') },
  'GET /api/servers/:id/snapshots': { server: fromParam('id') },
  'DELETE /api/servers/:id/snapshots/:snapshotId': { server: fromParam('id') },
  'GET /api/servers/:id/db': { server: fromParam('id') },
  'POST /api/servers/:id/db': { server: fromParam('id') },
  'DELETE /api/db/:connId': { server: fromDbConnection },
  'GET /api/db/:connId/tables': { server: fromDbConnection },
  'POST /api/db/:connId/columns': { server: fromDbConnection },
  'POST /api/db/:connId/preview': { server: fromDbConnection },
  'POST /api/db/:connId/query': { server: fromDbConnection },
  'POST /api/runs': { server: fromBody(['serverId']) },
  'POST /api/runs/preview': { server: fromBody(['serverId']) },
  'POST /api/runs/query': { server: fromBody(['serverId']) },
  'POST /api/runs/:id/cancel': { server: fromRun },
  'GET /api/runs/:id/stream': { server: fromRun },
  'GET /api/terminal/:serverId': { server: fromParam('serverId') },
  'POST /api/transfer': { server: fromBody(['from', 'serverId'], ['to', 'serverId']) },
};

export const ruleKey = (method: string, url: string) => `${method} ${url}`;

/** Events worth an audit line even though they are reads. */
const AUDITED_READS = new Set(['GET /api/servers/:id/fs/download', 'GET /api/terminal/:serverId']);

export function registerHosted(app: FastifyInstance, ctx: AppContext, hosted: HostedContext): void {
  const { users } = hosted;
  // 1. Who is this? (before anything else, even for the WebSocket upgrade)
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api')) return; // the built web app is public: it only shows the login screen
    const route = req.routeOptions?.url;
    const rule = route
      ? MEMBER_RULES[ruleKey(req.method === 'HEAD' ? 'GET' : req.method, route)]
      : undefined;
    const found = users.resolve(cookieValue(req.headers.cookie, SESSION_COOKIE));
    if (found) {
      req.user = found.user;
      req.sessionId = found.sessionId;
      req.accessible = users.accessibleServers(found.user);
    } else req.accessible = [];
    if (rule?.public) return;
    if (!found) return reply.code(401).send({ error: 'unauthorized' });
    // A cookie is sent by the browser on its own: changes must come from our own origin (SameSite=Strict is the first lock).
    if (MUTATING.has(req.method)) {
      const origin = req.headers.origin;
      if (!origin || !ctx.allowedOrigins.includes(origin))
        return reply.code(403).send({ error: 'bad_origin' });
    }
  });

  // 2. May they do THIS? Deny by default: unlisted routes are administrator-only.
  app.addHook('preHandler', async (req, reply) => {
    const route = req.routeOptions?.url;
    if (!route?.startsWith('/api') || !req.user) return;
    const rule = MEMBER_RULES[ruleKey(req.method === 'HEAD' ? 'GET' : req.method, route)];
    if (rule?.public) return;
    if (req.user.role === 'admin') return;
    if (!rule) return reply.code(403).send({ error: 'admin_only' });
    if (rule.anyone) return;
    const ids = rule.server?.(req, ctx) ?? null;
    if (!ids || ids.length === 0 || !ids.every((id) => users.canUse(req.user!, id)))
      return reply.code(403).send({ error: 'no_access' });
  });

  // 3. Who did what: every change, plus downloads and terminals. Never bodies, queries or keystrokes.
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url;
    if (!route?.startsWith('/api') || !req.user) return;
    const key = ruleKey(req.method, route);
    if (!MUTATING.has(req.method) && !AUDITED_READS.has(key)) return;
    if (route.startsWith('/api/auth/')) return; // the auth routes audit themselves, with better detail
    const params = (req.params ?? {}) as Record<string, string | undefined>;
    users.audit({
      user: req.user,
      ip: req.ip,
      event: key,
      serverId: params.id ?? params.serverId ?? null,
      ok: reply.statusCode < 400,
      detail: `HTTP ${reply.statusCode}`,
    });
  });
}
