import { EventEmitter } from 'node:events';
import { eq } from 'drizzle-orm';
import type { Client } from 'ssh2';
import type { Vault } from '../crypto/vault.js';
import type { Db } from '../db/index.js';
import { servers } from '../db/schema.js';
import { connect, type ConnectOutcome, type Target } from './connect.js';
import type { HostKeyStore } from './hostKeys.js';

export type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Connect result without the live Client, safe to send to the browser. */
export type PublicOutcome =
  Exclude<ConnectOutcome, { status: 'connected' }> | { status: 'connected' };

interface Pending {
  keyType: string;
  fingerprint: string;
  changed: boolean;
}

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/** One live ssh2 Client per server, with keep-alive and automatic reconnect. Emits 'status'. */
export class SshPool extends EventEmitter {
  private clients = new Map<string, Client>();
  private statuses = new Map<string, ConnStatus>();
  private pending = new Map<string, Pending>();
  private timers = new Map<string, NodeJS.Timeout>();
  private wanted = new Set<string>(); // servers we should keep alive (not manually disconnected)

  constructor(
    private db: Db,
    private vault: Vault,
    private hostKeys: HostKeyStore,
  ) {
    super();
  }

  status(id: string): ConnStatus {
    return this.statuses.get(id) ?? 'disconnected';
  }

  allStatuses(): Record<string, ConnStatus> {
    return Object.fromEntries(this.statuses);
  }

  /** For later milestones (terminal, SFTP, runner). */
  getClient(id: string): Client | undefined {
    return this.status(id) === 'connected' ? this.clients.get(id) : undefined;
  }

  private setStatus(id: string, s: ConnStatus) {
    if (this.statuses.get(id) === s) return;
    this.statuses.set(id, s);
    this.emit('status', id, s);
  }

  private target(id: string): Target | undefined {
    const row = this.db.select().from(servers).where(eq(servers.id, id)).get();
    if (!row) return undefined;
    const secret = JSON.parse(this.vault.decrypt(row.credential)) as Target['secret'];
    return { id, host: row.host, port: row.port, username: row.username, secret };
  }

  async connect(id: string): Promise<PublicOutcome> {
    if (this.getClient(id)) return { status: 'connected' };
    const target = this.target(id);
    if (!target) return { status: 'error', message: 'server not found' };

    this.clearTimer(id);
    this.wanted.add(id);
    this.setStatus(id, 'connecting');
    const outcome = await connect(target, this.hostKeys);

    if (outcome.status !== 'connected') {
      if (outcome.status === 'host_key_unknown' || outcome.status === 'host_key_changed') {
        this.pending.set(id, {
          keyType: outcome.keyType,
          fingerprint: outcome.fingerprint,
          changed: outcome.status === 'host_key_changed',
        });
      }
      this.wanted.delete(id);
      // An unknown key is not an error, just waiting for the user's approval.
      // A CHANGED key is a real problem and stays red.
      this.setStatus(id, outcome.status === 'host_key_unknown' ? 'disconnected' : 'error');
      return outcome;
    }

    const client = outcome.client;
    this.clients.set(id, client);
    this.pending.delete(id);
    this.setStatus(id, 'connected');
    client.on('error', () => {}); // errors surface through 'close'
    client.on('close', () => {
      if (this.clients.get(id) !== client) return; // already replaced or manually closed
      this.clients.delete(id);
      if (this.wanted.has(id)) {
        this.setStatus(id, 'connecting');
        this.scheduleReconnect(id, 0);
      } else {
        this.setStatus(id, 'disconnected');
      }
    });
    return { status: 'connected' };
  }

  private scheduleReconnect(id: string, attempt: number) {
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
    const t = setTimeout(async () => {
      this.timers.delete(id);
      if (!this.wanted.has(id)) return;
      let outcome: PublicOutcome;
      try {
        outcome = await this.connect(id);
      } catch {
        outcome = { status: 'error', message: 'reconnect failed' }; // e.g. vault got locked
      }
      // Host-key or auth problems won't fix themselves: stop and let the user act.
      if (outcome.status === 'error' && this.wanted.has(id)) {
        this.setStatus(id, 'connecting');
        this.scheduleReconnect(id, attempt + 1);
      }
    }, delay);
    t.unref();
    this.timers.set(id, t);
  }

  /**
   * The user saw `fingerprint` and approved it. It must match the one we recorded
   * from the failed handshake, so they approve exactly what they were shown.
   * Replacing a CHANGED key additionally requires `replace: true`.
   */
  trustHostKey(
    id: string,
    fingerprint: string,
    replace = false,
  ): 'ok' | 'no_pending' | 'mismatch' | 'replace_required' {
    const p = this.pending.get(id);
    if (!p) return 'no_pending';
    if (p.fingerprint !== fingerprint) return 'mismatch';
    if (p.changed && !replace) return 'replace_required';
    this.hostKeys.save(id, { keyType: p.keyType, fingerprint: p.fingerprint });
    this.pending.delete(id);
    return 'ok';
  }

  disconnect(id: string) {
    this.wanted.delete(id);
    this.clearTimer(id);
    const c = this.clients.get(id);
    this.clients.delete(id);
    c?.end();
    this.pending.delete(id);
    if (this.statuses.has(id)) this.setStatus(id, 'disconnected');
  }

  disconnectAll() {
    for (const id of [...this.statuses.keys()]) this.disconnect(id);
  }

  private clearTimer(id: string) {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }
}
