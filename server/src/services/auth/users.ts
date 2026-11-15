import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { AuditEntry, SessionRow, SessionUser, UserRole, UserRow } from '@gfv/shared';
import { decryptWithKey, encryptWithKey } from '../../crypto/vault.js';
import { hashPassword, verifyPassword } from '../../crypto/password.js';
import { newTotpSecret, otpauthUrl, verifyTotp } from '../../crypto/totp.js';
import { dataDir, type Db } from '../../db/index.js';
import { auditLog, serverAccess, servers, sessions, users } from '../../db/schema.js';

export class AuthError extends Error {
  constructor(
    readonly code:
      | 'invalid_credentials'
      | 'totp_required'
      | 'too_many_attempts'
      | 'exists'
      | 'not_found'
      | 'last_admin'
      | 'bad_code'
      | 'wrong_password'
      | 'no_2fa',
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

const IDLE_MS = 12 * 3600_000;
const ABSOLUTE_MS = 7 * 24 * 3600_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** A 32-byte key kept next to the database (mode 600). It encrypts TOTP secrets, so the database file alone does not reveal them. */
function authKey(file = join(dataDir(), 'auth.key')): Buffer {
  if (existsSync(file)) return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  chmodSync(file, 0o600);
  return key;
}

interface Attempts {
  fails: number;
  until: number;
}

/**
 * Accounts, sessions, 2FA and the audit log for hosted mode. Everything that proves identity lives here, so the
 * rules (uniform errors, throttling, replay protection, hashed tokens) are in one place.
 */
export class UserService {
  private key: Buffer;
  private attempts = new Map<string, Attempts>();
  private lastSeenWrite = new Map<string, number>();
  private dummyHash: Promise<string>;

  constructor(
    private db: Db,
    private opts: { scryptN?: number; keyFile?: string; now?: () => number } = {},
  ) {
    this.key = authKey(opts.keyFile);
    this.dummyHash = hashPassword('not-a-real-account', opts.scryptN);
  }

  private now = () => this.opts.now?.() ?? Date.now();

  // ---- audit ---------------------------------------------------------------------------------------------------------
  audit(e: {
    user?: { id: string; username: string } | null;
    ip?: string | null;
    event: string;
    serverId?: string | null;
    ok?: boolean;
    detail?: string;
  }): void {
    try {
      this.db
        .insert(auditLog)
        .values({
          at: this.now(),
          userId: e.user?.id ?? null,
          username: e.user?.username ?? null,
          ip: e.ip ?? null,
          event: e.event,
          serverId: e.serverId ?? null,
          ok: e.ok ?? true,
          detail: e.detail?.slice(0, 300) ?? null,
        })
        .run();
    } catch {
      /* the audit log must never take a request down */
    }
  }

  listAudit(limit = 200): AuditEntry[] {
    return this.db
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.id))
      .limit(Math.min(limit, 1000))
      .all();
  }

  // ---- accounts ------------------------------------------------------------------------------------------------------
  count(): number {
    return this.db.select({ id: users.id }).from(users).all().length;
  }

  private toSession(u: typeof users.$inferSelect): SessionUser {
    return { id: u.id, username: u.username, role: u.role, totpEnabled: u.totpEnabled };
  }

  async create(username: string, password: string, role: UserRole): Promise<SessionUser> {
    if (this.db.select().from(users).where(eq(users.username, username)).get())
      throw new AuthError('exists', 'That username is taken.');
    const row = {
      id: randomUUID(),
      username,
      passwordHash: await hashPassword(password, this.opts.scryptN),
      role,
      disabled: false,
      totpSecret: null,
      totpPending: null,
      totpEnabled: false,
      totpLastStep: null,
      recoveryHashes: [] as string[],
      createdAt: this.now(),
      lastLoginAt: null,
    };
    this.db.insert(users).values(row).run();
    return this.toSession(row);
  }

  list(): UserRow[] {
    const access = this.db.select().from(serverAccess).all();
    return this.db
      .select()
      .from(users)
      .all()
      .map((u) => ({
        ...this.toSession(u),
        disabled: u.disabled,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        serverIds: access.filter((a) => a.userId === u.id).map((a) => a.serverId),
      }));
  }

  get(id: string) {
    return this.db.select().from(users).where(eq(users.id, id)).get();
  }

  private adminCount(): number {
    return this.db
      .select()
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.disabled, false)))
      .all().length;
  }

  setDisabled(id: string, disabled: boolean): void {
    const u = this.get(id);
    if (!u) throw new AuthError('not_found', 'No such user.');
    if (disabled && u.role === 'admin' && !u.disabled && this.adminCount() <= 1)
      throw new AuthError('last_admin', 'You cannot disable the last administrator.');
    this.db.update(users).set({ disabled }).where(eq(users.id, id)).run();
    if (disabled) this.revokeAll(id);
  }

  setRole(id: string, role: UserRole): void {
    const u = this.get(id);
    if (!u) throw new AuthError('not_found', 'No such user.');
    if (u.role === 'admin' && role !== 'admin' && !u.disabled && this.adminCount() <= 1)
      throw new AuthError('last_admin', 'You cannot demote the last administrator.');
    this.db.update(users).set({ role }).where(eq(users.id, id)).run();
  }

  remove(id: string): void {
    const u = this.get(id);
    if (!u) throw new AuthError('not_found', 'No such user.');
    if (u.role === 'admin' && !u.disabled && this.adminCount() <= 1)
      throw new AuthError('last_admin', 'You cannot delete the last administrator.');
    this.db.delete(users).where(eq(users.id, id)).run();
  }

  async setPassword(id: string, password: string): Promise<void> {
    this.db
      .update(users)
      .set({ passwordHash: await hashPassword(password, this.opts.scryptN) })
      .where(eq(users.id, id))
      .run();
    this.revokeAll(id); // a new password signs every device out
  }

  async changeOwnPassword(
    id: string,
    oldPassword: string,
    newPassword: string,
    keepSession?: string,
  ): Promise<void> {
    const u = this.get(id);
    if (!u || !(await verifyPassword(oldPassword, u.passwordHash)))
      throw new AuthError('wrong_password', 'The current password is wrong.');
    await this.setPassword(id, newPassword);
    void keepSession; // other devices are signed out; the caller signs in again (simple and safe)
  }

  // ---- server access -------------------------------------------------------------------------------------------------
  setAccess(userId: string, serverIds: string[]): void {
    const real = new Set(
      this.db
        .select({ id: servers.id })
        .from(servers)
        .all()
        .map((s) => s.id),
    );
    const ids = [...new Set(serverIds)].filter((s) => real.has(s));
    this.db.transaction(() => {
      this.db.delete(serverAccess).where(eq(serverAccess.userId, userId)).run();
      for (const serverId of ids) this.db.insert(serverAccess).values({ userId, serverId }).run();
    });
  }

  accessibleServers(user: SessionUser): string[] | 'all' {
    if (user.role === 'admin') return 'all';
    return this.db
      .select()
      .from(serverAccess)
      .where(eq(serverAccess.userId, user.id))
      .all()
      .map((a) => a.serverId);
  }

  canUse(user: SessionUser, serverId: string): boolean {
    if (user.role === 'admin') return true;
    return !!this.db
      .select()
      .from(serverAccess)
      .where(and(eq(serverAccess.userId, user.id), eq(serverAccess.serverId, serverId)))
      .get();
  }

  // ---- login ---------------------------------------------------------------------------------------------------------
  private throttleKey = (username: string, ip: string) => `${username}|${ip}`;

  private checkThrottle(k: string): void {
    const a = this.attempts.get(k);
    if (a && a.until > this.now()) {
      const sec = Math.ceil((a.until - this.now()) / 1000);
      throw new AuthError(
        'too_many_attempts',
        `Too many attempts. Try again in ${sec} seconds.`,
        sec,
      );
    }
  }
  private fail(k: string): void {
    const a = this.attempts.get(k) ?? { fails: 0, until: 0 };
    a.fails++;
    // 3 free tries, then 1 s, 2 s, 4 s ... capped at 5 minutes.
    a.until = a.fails > 3 ? this.now() + Math.min(2 ** (a.fails - 4) * 1000, 300_000) : 0;
    this.attempts.set(k, a);
  }

  /**
   * Password first, then (if enabled) the authenticator code or a recovery code. Every failure looks the same from
   * outside, a missing account costs the same time as a wrong password, and repeated failures slow down.
   */
  async login(
    username: string,
    password: string,
    code: string | undefined,
    ip: string,
  ): Promise<SessionUser> {
    const k = this.throttleKey(username, ip);
    this.checkThrottle(k);
    const u = this.db.select().from(users).where(eq(users.username, username)).get();
    const ok = await verifyPassword(password, u?.passwordHash ?? (await this.dummyHash));
    if (!u || !ok || u.disabled) {
      this.fail(k);
      throw new AuthError('invalid_credentials', 'Wrong username or password.');
    }
    if (u.totpEnabled) {
      if (!code)
        throw new AuthError('totp_required', 'Enter the code from your authenticator app.');
      if (!this.checkSecondFactor(u, code)) {
        this.fail(k);
        throw new AuthError('invalid_credentials', 'Wrong code.');
      }
    }
    this.attempts.delete(k);
    this.db.update(users).set({ lastLoginAt: this.now() }).where(eq(users.id, u.id)).run();
    return this.toSession(u);
  }

  private checkSecondFactor(u: typeof users.$inferSelect, code: string): boolean {
    const clean = code.trim();
    if (/^\d{6}$/.test(clean) && u.totpSecret) {
      const step = verifyTotp(decryptWithKey(this.key, u.totpSecret), clean, this.now());
      if (step === null || (u.totpLastStep !== null && step <= u.totpLastStep)) return false; // wrong, or a replay
      this.db.update(users).set({ totpLastStep: step }).where(eq(users.id, u.id)).run();
      return true;
    }
    const h = sha(clean.toLowerCase().replace(/\s|-/g, ''));
    if (u.recoveryHashes.includes(h)) {
      this.db
        .update(users)
        .set({ recoveryHashes: u.recoveryHashes.filter((x) => x !== h) })
        .where(eq(users.id, u.id))
        .run();
      return true; // a recovery code works once
    }
    return false;
  }

  // ---- two-factor enrolment ------------------------------------------------------------------------------------------
  begin2fa(id: string): { secret: string; otpauth: string } {
    const u = this.get(id);
    if (!u) throw new AuthError('not_found', 'No such user.');
    const secret = newTotpSecret();
    this.db
      .update(users)
      .set({ totpPending: encryptWithKey(this.key, secret) })
      .where(eq(users.id, id))
      .run();
    return { secret, otpauth: otpauthUrl(secret, u.username) };
  }

  /** Confirms the pending secret with a code from the app; returns the recovery codes (shown once). */
  confirm2fa(id: string, code: string): string[] {
    const u = this.get(id);
    if (!u?.totpPending) throw new AuthError('bad_code', 'Start the setup again.');
    const secret = decryptWithKey(this.key, u.totpPending);
    const step = verifyTotp(secret, code.trim(), this.now());
    if (step === null)
      throw new AuthError(
        'bad_code',
        'That code is not right. Check the time on your phone and try again.',
      );
    const codes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex'));
    this.db
      .update(users)
      .set({
        totpSecret: encryptWithKey(this.key, secret),
        totpPending: null,
        totpEnabled: true,
        totpLastStep: step,
        recoveryHashes: codes.map(sha),
      })
      .where(eq(users.id, id))
      .run();
    return codes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`);
  }

  async disable2fa(id: string, password: string): Promise<void> {
    const u = this.get(id);
    if (!u || !(await verifyPassword(password, u.passwordHash)))
      throw new AuthError('wrong_password', 'The password is wrong.');
    this.reset2fa(id);
  }

  /** Admin recovery for a member who lost their phone. */
  reset2fa(id: string): void {
    this.db
      .update(users)
      .set({
        totpSecret: null,
        totpPending: null,
        totpEnabled: false,
        totpLastStep: null,
        recoveryHashes: [],
      })
      .where(eq(users.id, id))
      .run();
  }

  // ---- sessions ------------------------------------------------------------------------------------------------------
  createSession(
    userId: string,
    ip: string,
    userAgent: string | undefined,
  ): { token: string; maxAgeSec: number } {
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    this.db
      .insert(sessions)
      .values({
        id: sha(token),
        userId,
        createdAt: now,
        lastSeen: now,
        expiresAt: now + ABSOLUTE_MS,
        ip,
        userAgent: userAgent?.slice(0, 200) ?? null,
      })
      .run();
    this.db.delete(sessions).where(lt(sessions.expiresAt, now)).run(); // tidy up
    return { token, maxAgeSec: ABSOLUTE_MS / 1000 };
  }

  /** The signed-in user for a cookie token, or null (unknown, expired, idle too long, or the account was disabled). */
  resolve(token: string | undefined): { user: SessionUser; sessionId: string } | null {
    if (!token) return null;
    const id = sha(token);
    const s = this.db.select().from(sessions).where(eq(sessions.id, id)).get();
    if (!s) return null;
    const now = this.now();
    if (s.expiresAt < now || now - s.lastSeen > IDLE_MS) {
      this.db.delete(sessions).where(eq(sessions.id, id)).run();
      return null;
    }
    const u = this.get(s.userId);
    if (!u || u.disabled) return null;
    // Sliding idle timeout: write at most once a minute.
    if (now - (this.lastSeenWrite.get(id) ?? 0) > 60_000) {
      this.db.update(sessions).set({ lastSeen: now }).where(eq(sessions.id, id)).run();
      this.lastSeenWrite.set(id, now);
    }
    return { user: this.toSession(u), sessionId: id };
  }

  revoke(sessionId: string): void {
    this.db.delete(sessions).where(eq(sessions.id, sessionId)).run();
  }
  revokeAll(userId: string): void {
    this.db.delete(sessions).where(eq(sessions.userId, userId)).run();
  }
  listSessions(userId: string, current?: string): SessionRow[] {
    return this.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .all()
      .map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        lastSeen: s.lastSeen,
        ip: s.ip,
        userAgent: s.userAgent,
        current: s.id === current,
      }));
  }
  ownsSession(userId: string, sessionId: string): boolean {
    return !!this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
      .get();
  }
  idsOf(userIds: string[]) {
    return this.db.select().from(users).where(inArray(users.id, userIds)).all();
  }
}
