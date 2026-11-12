import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import {
  actionById,
  DEFAULT_CTX,
  type ActionCtx,
  previewAction,
  redactParams,
  redactSecrets,
  type Preview,
  type RunMsg,
} from '@gfv/shared';
import type { Client } from 'ssh2';
import type { Db } from '../../db/index.js';
import { history } from '../../db/schema.js';
import type { SshPool } from '../../ssh/pool.js';
import { Run } from './run.js';

export type StartResult =
  | { ok: true; run: Run; preview: Preview }
  | { ok: false; error: 'unknown_action' }
  | { ok: false; error: 'invalid_params'; issues: { path: (string | number)[]; message: string }[] }
  | { ok: false; error: 'not_connected' }
  | { ok: false; error: 'confirmation_required'; risk: 'caution' | 'danger' };

const KEEP_FINISHED_MS = 5 * 60_000;
const QUERY_TIMEOUT_MS = 10_000;
const QUERY_MAX_BYTES = 1 << 20;

export type QueryResult =
  | { ok: true; exitCode: number; stdout: string; stderr: string }
  | {
      ok: false;
      error: 'unknown_action' | 'not_connected' | 'not_quiet' | 'timeout' | 'failed';
      message?: string;
    }
  | {
      ok: false;
      error: 'invalid_params';
      issues: { path: (string | number)[]; message: string }[];
    };

/**
 * The Command Runner: the one place GUI actions turn into SSH commands.
 * validate -> preview -> (server-side) confirmation check -> run commands in order -> history.
 */
export class Runner {
  private runs = new Map<string, Run>();
  // Per live connection (a reconnect is a new Client, so it is detected again).
  private ctxs = new WeakMap<Client, Promise<ActionCtx>>();

  constructor(
    private db: Db,
    private pool: SshPool,
  ) {}

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  /** What differs per server (root or sudo). Falls back to sudo when we can't ask (not connected). */
  async ctxFor(serverId: string): Promise<ActionCtx> {
    const client = this.pool.getClient(serverId);
    if (!client) return DEFAULT_CTX;
    let p = this.ctxs.get(client);
    if (!p) {
      p = this.detectCtx(client);
      this.ctxs.set(client, p);
    }
    return p;
  }

  private async detectCtx(client: Client): Promise<ActionCtx> {
    try {
      let out = '';
      await execStep(client, 'id -u', (m) => m.type === 'output' && (out += m.text), 5000);
      return { sudo: out.trim() === '0' ? '' : 'sudo -n ' };
    } catch {
      return DEFAULT_CTX;
    }
  }

  async preview(serverId: string, actionId: string, params: unknown) {
    return previewAction(actionId, params, await this.ctxFor(serverId));
  }

  /**
   * Quiet read-only query for polling views (metrics, lists, logs): no dialog, no history.
   * Only actions marked `quiet` (always `safe`) are allowed; everything else needs `start`.
   */
  async query(serverId: string, actionId: string, params: unknown): Promise<QueryResult> {
    const action = actionById(actionId);
    if (!action) return { ok: false, error: 'unknown_action' };
    if (!action.quiet) return { ok: false, error: 'not_quiet' };
    const client = this.pool.getClient(serverId);
    if (!client) return { ok: false, error: 'not_connected' };
    const p = previewAction(actionId, params, await this.ctxFor(serverId));
    if (!p.ok) return p;
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    try {
      for (const command of p.preview.commands) {
        exitCode = await execStep(
          client,
          command,
          (m) => {
            if (m.type !== 'output') return;
            if (m.stream === 'stdout' && stdout.length < QUERY_MAX_BYTES) stdout += m.text;
            else if (m.stream === 'stderr' && stderr.length < QUERY_MAX_BYTES) stderr += m.text;
          },
          QUERY_TIMEOUT_MS,
        );
        if (exitCode !== 0) break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'query failed';
      return { ok: false, error: message === 'timeout' ? 'timeout' : 'failed', message };
    }
    return { ok: true, exitCode, stdout, stderr };
  }

  /** `record: false` skips history (used by "Test connection", which isn't something to learn from). */
  async start(
    serverId: string,
    actionId: string,
    params: unknown,
    opts: { confirmed?: boolean; record?: boolean } = {},
  ): Promise<StartResult> {
    const p = previewAction(actionId, params, await this.ctxFor(serverId));
    if (!p.ok) return p;
    const { preview } = p;
    // The Safety Net lives HERE, not in the UI: a buggy or hostile client can't skip it.
    if (preview.risk !== 'safe' && !opts.confirmed) {
      return { ok: false, error: 'confirmation_required', risk: preview.risk };
    }
    const client = this.pool.getClient(serverId);
    if (!client) return { ok: false, error: 'not_connected' };

    const run = new Run(randomUUID());
    this.runs.set(run.id, run);
    void this.execute(run, client, serverId, preview, p.params, opts.record ?? true).finally(() => {
      setTimeout(() => this.runs.delete(run.id), KEEP_FINISHED_MS).unref();
    });
    return { ok: true, run, preview };
  }

  private async execute(
    run: Run,
    client: Client,
    serverId: string,
    preview: Preview,
    params: unknown,
    record: boolean,
  ): Promise<void> {
    const startedAt = Date.now();
    const action = actionById(preview.actionId)!;
    const total = preview.commands.length;
    let exitCode: number | null = 0;
    let failedStep: number | undefined;

    try {
      for (let i = 0; i < total; i++) {
        run.emit({ type: 'step', index: i, total, command: preview.commands[i]! });
        const code = await execStep(client, preview.commands[i]!, (m) => run.emit(m));
        if (code !== 0) {
          exitCode = code;
          failedStep = i;
          break; // later steps often depend on earlier ones
        }
      }
      run.emit({ type: 'done', exitCode, ...(failedStep !== undefined ? { failedStep } : {}) });
    } catch (err) {
      exitCode = null;
      const message = err instanceof Error ? err.message : 'command failed';
      run.emit({ type: 'error', message });
    }

    if (!record) return;
    const redact = (t: string) => redactSecrets(action, params, t);
    try {
      this.db
        .insert(history)
        .values({
          id: run.id,
          serverId,
          actionId: preview.actionId,
          title: preview.title,
          params: redactParams(action, params),
          commands: preview.commands.map(redact),
          risk: preview.risk,
          exitCode,
          startedAt,
          finishedAt: Date.now(),
          outputTail: redact(run.outputTail),
        })
        .run();
    } catch {
      // The server may have been deleted mid-run (FK). History is best effort.
    }
  }
}

/** Run one command on its own exec channel, streaming output. Resolves with the exit code. */
function execStep(
  client: Client,
  command: string,
  emit: (m: RunMsg) => void,
  timeoutMs?: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      // Quiet queries must not hang forever on a stuck command.
      const timer = timeoutMs
        ? setTimeout(() => {
            client.off('close', onClientClose);
            stream.close();
            reject(new Error('timeout'));
          }, timeoutMs)
        : undefined;
      const out = new StringDecoder('utf8'); // never split a multi-byte character across chunks
      const errDec = new StringDecoder('utf8');
      const onClientClose = () => {
        clearTimeout(timer);
        reject(new Error('The connection to the server was lost.'));
      };
      client.once('close', onClientClose);
      stream.on('data', (d: Buffer) =>
        emit({ type: 'output', stream: 'stdout', text: out.write(d) }),
      );
      stream.stderr.on('data', (d: Buffer) =>
        emit({ type: 'output', stream: 'stderr', text: errDec.write(d) }),
      );
      stream.on('close', (code: number | null, signal?: string) => {
        clearTimeout(timer);
        client.off('close', onClientClose);
        const rest = out.end() + errDec.end();
        if (rest) emit({ type: 'output', stream: 'stdout', text: rest });
        resolve(code ?? (signal ? 128 : -1));
      });
    });
  });
}
