import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AccessBodySchema,
  ChangePasswordSelfSchema,
  CreateUserBodySchema,
  LoginBodySchema,
  SetupBodySchema,
  USER_ROLES,
  type AuthStatus,
} from '@gfv/shared';
import type { AppContext } from '../context.js';
import { clearSessionCookie, isSecureEnough, safeEqual, sessionCookieHeader } from '../hosted.js';
import { AuthError } from '../services/auth/users.js';
import { parseBody } from './util.js';

const STATUS: Record<AuthError['code'], number> = {
  invalid_credentials: 401,
  totp_required: 401,
  too_many_attempts: 429,
  exists: 409,
  not_found: 404,
  last_admin: 409,
  bad_code: 400,
  wrong_password: 403,
  no_2fa: 400,
};

/** Sign-in, 2FA, sessions, accounts and the audit log. In local mode only `GET /api/auth/status` exists. */
export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  const hosted = ctx.hosted;
  if (!hosted) {
    app.get('/api/auth/status', async (): Promise<AuthStatus> => ({
      hosted: false,
      setupNeeded: false,
      user: null,
    }));
    return;
  }
  const { users, setupToken } = hosted;
  let setupFails = 0;

  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof AuthError) {
      if (e.retryAfterSec) void reply.header('retry-after', e.retryAfterSec);
      return reply.code(STATUS[e.code]).send({
        error: e.code,
        message: e.message,
        ...(e.retryAfterSec ? { retryAfterSec: e.retryAfterSec } : {}),
      });
    }
    throw e;
  };
  const secure = (req: FastifyRequest) => req.protocol === 'https';
  const signIn = (req: FastifyRequest, reply: FastifyReply, userId: string) => {
    const s = users.createSession(userId, req.ip, req.headers['user-agent']);
    void reply.header('set-cookie', sessionCookieHeader(s.token, s.maxAgeSec, secure(req)));
  };
  const needHttps = (req: FastifyRequest, reply: FastifyReply) => {
    if (isSecureEnough(req)) return false;
    void reply.code(400).send({
      error: 'https_required',
      message:
        'Sign in over HTTPS. This address is plain http, so your password would cross the network unprotected.',
    });
    return true;
  };

  app.get('/api/auth/status', async (req): Promise<AuthStatus> => ({
    hosted: true,
    setupNeeded: users.count() === 0,
    user: req.user ?? null,
  }));

  /** First run: the setup token printed on the server's console creates the first administrator. */
  app.post('/api/auth/setup', async (req, reply) => {
    if (needHttps(req, reply)) return;
    const body = parseBody(SetupBodySchema, req.body, reply);
    if (!body) return;
    if (users.count() > 0) return reply.code(409).send({ error: 'already_set_up' });
    if (setupFails >= 5)
      return reply.code(429).send({
        error: 'too_many_attempts',
        message: 'Too many wrong setup tokens. Restart GFV to try again.',
      });
    if (!safeEqual(body.setupToken, setupToken)) {
      setupFails++;
      users.audit({ ip: req.ip, event: 'auth.setup', ok: false, detail: 'wrong setup token' });
      return reply.code(403).send({
        error: 'bad_setup_token',
        message: 'That is not the setup token printed on the server.',
      });
    }
    const admin = await users.create(body.username, body.password, 'admin');
    users.audit({ user: admin, ip: req.ip, event: 'auth.setup' });
    signIn(req, reply, admin.id);
    return admin;
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (needHttps(req, reply)) return;
    const body = parseBody(LoginBodySchema, req.body, reply);
    if (!body) return;
    try {
      const u = await users.login(body.username, body.password, body.code, req.ip);
      users.audit({ user: u, ip: req.ip, event: 'auth.login' });
      signIn(req, reply, u.id);
      return u;
    } catch (e) {
      if (e instanceof AuthError && e.code !== 'totp_required')
        users.audit({
          ip: req.ip,
          event: 'auth.login',
          ok: false,
          detail: `${e.code} for "${body.username.slice(0, 40)}"`,
        });
      return fail(reply, e);
    }
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionId) users.revoke(req.sessionId);
    users.audit({ user: req.user, ip: req.ip, event: 'auth.logout' });
    void reply.header('set-cookie', clearSessionCookie(secure(req)));
    return { ok: true };
  });

  app.post('/api/auth/password', async (req, reply) => {
    const body = parseBody(ChangePasswordSelfSchema, req.body, reply);
    if (!body) return;
    try {
      await users.changeOwnPassword(req.user!.id, body.oldPassword, body.newPassword);
      users.audit({ user: req.user, ip: req.ip, event: 'auth.password' });
      void reply.header('set-cookie', clearSessionCookie(secure(req))); // every device, this one included, signs in again
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ---- two-factor
  app.post('/api/auth/2fa/begin', async (req) => users.begin2fa(req.user!.id));
  app.post('/api/auth/2fa/confirm', async (req, reply) => {
    const body = parseBody(z.object({ code: z.string().min(6).max(8) }), req.body, reply);
    if (!body) return;
    try {
      const codes = users.confirm2fa(req.user!.id, body.code);
      users.audit({ user: req.user, ip: req.ip, event: 'auth.2fa.enabled' });
      return { recoveryCodes: codes };
    } catch (e) {
      return fail(reply, e);
    }
  });
  app.post('/api/auth/2fa/disable', async (req, reply) => {
    const body = parseBody(z.object({ password: z.string().min(1) }), req.body, reply);
    if (!body) return;
    try {
      await users.disable2fa(req.user!.id, body.password);
      users.audit({ user: req.user, ip: req.ip, event: 'auth.2fa.disabled' });
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // ---- my sessions
  app.get('/api/auth/sessions', async (req) => users.listSessions(req.user!.id, req.sessionId));
  app.delete<{ Params: { id: string } }>('/api/auth/sessions/:id', async (req, reply) => {
    if (!users.ownsSession(req.user!.id, req.params.id))
      return reply.code(404).send({ error: 'not_found' });
    users.revoke(req.params.id);
    users.audit({ user: req.user, ip: req.ip, event: 'auth.session.revoked' });
    return { ok: true };
  });

  // ---- administrators only (the access hook makes everything unlisted admin-only)
  app.get('/api/users', async () => users.list());

  app.post('/api/users', async (req, reply) => {
    const body = parseBody(CreateUserBodySchema, req.body, reply);
    if (!body) return;
    try {
      const u = await users.create(body.username, body.password, body.role);
      users.audit({
        user: req.user,
        ip: req.ip,
        event: 'user.create',
        detail: `${u.username} (${u.role})`,
      });
      return u;
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.patch<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    const body = parseBody(
      z.object({ role: z.enum(USER_ROLES).optional(), disabled: z.boolean().optional() }),
      req.body,
      reply,
    );
    if (!body) return;
    try {
      if (body.role) users.setRole(req.params.id, body.role);
      if (body.disabled !== undefined) users.setDisabled(req.params.id, body.disabled);
      users.audit({
        user: req.user,
        ip: req.ip,
        event: 'user.update',
        detail: `${users.get(req.params.id)?.username}: ${JSON.stringify(body)}`,
      });
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    if (req.params.id === req.user!.id)
      return reply
        .code(409)
        .send({ error: 'self', message: 'You cannot delete your own account.' });
    try {
      const name = users.get(req.params.id)?.username;
      users.remove(req.params.id);
      users.audit({ user: req.user, ip: req.ip, event: 'user.delete', detail: name });
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post<{ Params: { id: string } }>('/api/users/:id/password', async (req, reply) => {
    const body = parseBody(
      z.object({ password: CreateUserBodySchema.shape.password }),
      req.body,
      reply,
    );
    if (!body) return;
    if (!users.get(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    await users.setPassword(req.params.id, body.password);
    users.audit({
      user: req.user,
      ip: req.ip,
      event: 'user.password-reset',
      detail: users.get(req.params.id)?.username,
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/users/:id/reset-2fa', async (req, reply) => {
    if (!users.get(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    users.reset2fa(req.params.id);
    users.audit({
      user: req.user,
      ip: req.ip,
      event: 'user.2fa-reset',
      detail: users.get(req.params.id)?.username,
    });
    return { ok: true };
  });

  app.put<{ Params: { id: string } }>('/api/users/:id/access', async (req, reply) => {
    const body = parseBody(AccessBodySchema, req.body, reply);
    if (!body) return;
    if (!users.get(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    users.setAccess(req.params.id, body.serverIds);
    users.audit({
      user: req.user,
      ip: req.ip,
      event: 'user.access',
      detail: `${users.get(req.params.id)?.username}: ${body.serverIds.length} server(s)`,
    });
    return { ok: true };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/audit', async (req) =>
    users.listAudit(Number(req.query.limit) || 200),
  );
}
