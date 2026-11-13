import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import {
  actionById,
  DEFAULT_CTX,
  type ActionCtx,
  previewAction,
  redactParams,
  redactSecrets,
  SNAPSHOT_SAVED,
  type Preview,
  type RunMsg,
} from '@gfv/shared';
import type { Client } from 'ssh2';
import type { Db } from '../../db/index.js';
import { history, snapshots } from '../../db/schema.js';
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
const LONG_TIMEOUT_MS = 30 * 60_000;
const CANCEL_GRACE_MS = 3000;

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
  private snapshotListeners: ((e: { serverId: string; path: string }) => void)[] = [];
  private successListeners: ((e: {
    serverId: string;
    actionId: string;
    params: unknown;
  }) => void)[] = [];
  // Per live connection (a reconnect is a new Client, so it is detected again).
  private ctxs = new WeakMap<Client, Promise<ActionCtx>>();

  constructor(
    private db: Db,
    private pool: SshPool,
  ) {}

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  /** Called after a backup was recorded (the SFTP service prunes old ones). */
  onSnapshot(fn: (e: { serverId: string; path: string }) => void): void {
    this.snapshotListeners.push(fn);
  }

  /** Called after every run that finished successfully and is not a silent one (Recipes listens here). */
  onSuccess(fn: (e: { serverId: string; actionId: string; params: unknown }) => void): void {
    this.successListeners.push(fn);
  }

  /** A backup step printed "Snapshot saved: NAME (N bytes)": remember it so the timeline can show it. */
  private recordSnapshots(
    text: string,
    runId: string,
    serverId: string,
    preview: Preview,
    ctx: ActionCtx,
  ) {
    for (const m of text.matchAll(new RegExp(SNAPSHOT_SAVED.source, 'gm'))) {
      const snap = preview.snapshots.find((x) => x.name === m[1]);
      if (!snap) continue;
      try {
        this.db
          .insert(snapshots)
          .values({
            id: randomUUID(),
            serverId,
            path: snap.path,
            remotePath: `${ctx.home ?? ''}/.gfv/snapshots/${snap.name}`,
            sizeBytes: Number(m[2]),
            createdAt: Date.now(),
            source: preview.actionId,
            runId,
          })
          .run();
        for (const fn of this.snapshotListeners) fn({ serverId, path: snap.path });
      } catch {
        /* the server may have been deleted mid-run */
      }
    }
  }

  /** Stops a running run: Ctrl-C into its PTY, then a hard close if it ignores that. */
  cancel(id: string): boolean {
    const run = this.runs.get(id);
    if (!run || run.finished) return false;
    run.cancel('user');
    return true;
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
      await execStep(client, 'id -u; echo "$HOME"', (m) => m.type === 'output' && (out += m.text), {
        timeoutMs: 5000,
      });
      const [uid, home] = out.trim().split('\n');
      return {
        sudo: uid?.trim() === '0' ? '' : 'sudo -n ',
        ...(home?.trim() ? { home: home.trim() } : {}),
      };
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
          { timeoutMs: QUERY_TIMEOUT_MS },
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
    const runId = randomUUID();
    const ctx = await this.ctxFor(serverId);
    // The run id names the snapshot files, so the preview and the run agree on them.
    const p = previewAction(actionId, params, { ...ctx, runId });
    if (!p.ok) return p;
    const { preview } = p;
    // The Safety Net lives HERE, not in the UI: a buggy or hostile client can't skip it.
    if (preview.risk !== 'safe' && !opts.confirmed) {
      return { ok: false, error: 'confirmation_required', risk: preview.risk };
    }
    const client = this.pool.getClient(serverId);
    if (!client) return { ok: false, error: 'not_connected' };

    const run = new Run(runId);
    this.runs.set(run.id, run);
    void this.execute(run, client, serverId, preview, p.params, ctx, opts.record ?? true).finally(
      () => {
        setTimeout(() => this.runs.delete(run.id), KEEP_FINISHED_MS).unref();
      },
    );
    return { ok: true, run, preview };
  }

  private async execute(
    run: Run,
    client: Client,
    serverId: string,
    preview: Preview,
    params: unknown,
    ctx: ActionCtx,
    record: boolean,
  ): Promise<void> {
    const startedAt = Date.now();
    const action = actionById(preview.actionId)!;
    const total = preview.commands.length;
    let exitCode: number | null = 0;
    let failedStep: number | undefined;

    // Package installs take minutes: stop them after 30 minutes instead of hanging forever.
    const timer = action.longRunning
      ? setTimeout(() => run.cancel('timeout'), LONG_TIMEOUT_MS)
      : undefined;

    try {
      for (let i = 0; i < total; i++) {
        run.emit({ type: 'step', index: i, total, command: preview.commands[i]! });
        let stepText = '';
        const code = await execStep(
          client,
          preview.commands[i]!,
          (m) => {
            run.emit(m);
            if (m.type === 'output' && preview.snapshots.length) stepText += m.text;
          },
          { pty: !!action.longRunning, abort: run.abort.signal },
        );
        this.recordSnapshots(stepText, run.id, serverId, preview, ctx);
        if (code !== 0) {
          exitCode = code;
          failedStep = i;
          break; // later steps often depend on earlier ones
        }
        if (run.abort.signal.aborted) break; // cancelled between steps
      }
      // A run that was asked to stop but still finished cleanly counts as a success.
      const cancelled = exitCode !== 0 ? run.cancelReason : undefined;
      run.emit({
        type: 'done',
        exitCode,
        ...(failedStep !== undefined ? { failedStep } : {}),
        ...(cancelled ? { cancelled } : {}),
      });
    } catch (err) {
      exitCode = null;
      const message = err instanceof Error ? err.message : 'command failed';
      run.emit({ type: 'error', message });
    } finally {
      clearTimeout(timer);
    }

    if (exitCode === 0 && !run.cancelReason && record) {
      for (const fn of this.successListeners) fn({ serverId, actionId: preview.actionId, params });
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

interface StepOpts {
  /** Reject with Error('timeout') and close the channel after this long. */
  timeoutMs?: number;
  /**
   * Run in a pseudo-terminal. Slower to read (stdout and stderr merge), but Cancel then works
   * like Ctrl-C in a terminal: the whole process group stops, not just the outer shell.
   */
  pty?: boolean;
  abort?: AbortSignal;
}

/** Run one command on its own exec channel, streaming output. Resolves with the exit code. */
function execStep(
  client: Client,
  command: string,
  emit: (m: RunMsg) => void,
  opts: StepOpts = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    client.exec(command, opts.pty ? { pty: true } : {}, (err, stream) => {
      if (err) return reject(err);
      const timers: NodeJS.Timeout[] = [];
      const cleanup = () => {
        timers.forEach(clearTimeout);
        opts.abort?.removeEventListener('abort', onAbort);
        client.off('close', onClientClose);
      };
      function onAbort() {
        if (opts.pty)
          stream.write('\x03'); // Ctrl-C: the terminal signals the foreground group
        else stream.signal('TERM');
        timers.push(setTimeout(() => stream.close(), CANCEL_GRACE_MS)); // still there? hang up
      }
      function onClientClose() {
        cleanup();
        reject(new Error('The connection to the server was lost.'));
      }
      client.once('close', onClientClose);
      if (opts.abort?.aborted) onAbort();
      else opts.abort?.addEventListener('abort', onAbort, { once: true });
      // Quiet queries must not hang forever on a stuck command.
      if (opts.timeoutMs) {
        timers.push(
          setTimeout(() => {
            cleanup();
            stream.close();
            reject(new Error('timeout'));
          }, opts.timeoutMs),
        );
      }

      const out = new StringDecoder('utf8'); // never split a multi-byte character across chunks
      const errDec = new StringDecoder('utf8');
      // A PTY turns \n into \r\n and may redraw with bare \r: show plain lines.
      const clean = (t: string) => (opts.pty ? t.replace(/\r\n/g, '\n').replace(/\r/g, '') : t);
      stream.on('data', (d: Buffer) =>
        emit({ type: 'output', stream: 'stdout', text: clean(out.write(d)) }),
      );
      stream.stderr.on('data', (d: Buffer) =>
        emit({ type: 'output', stream: 'stderr', text: errDec.write(d) }),
      );
      stream.on('close', (code: number | null, signal?: string) => {
        cleanup();
        const rest = clean(out.end()) + errDec.end();
        if (rest) emit({ type: 'output', stream: 'stdout', text: rest });
        // Killed by a signal: the shell convention is 128 + the signal number (INT -> 130).
        const SIGNUM: Record<string, number> = { HUP: 1, INT: 2, QUIT: 3, KILL: 9, TERM: 15 };
        resolve(
          code ??
            (signal
              ? 128 + (SIGNUM[signal.replace(/^SIG/, '')] ?? 0)
              : opts.abort?.aborted
                ? 130
                : -1),
        );
      });
    });
  });
}
