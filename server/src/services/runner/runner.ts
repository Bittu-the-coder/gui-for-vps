import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import {
  actionById,
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

/**
 * The Command Runner: the one place GUI actions turn into SSH commands.
 * validate -> preview -> (server-side) confirmation check -> run commands in order -> history.
 */
export class Runner {
  private runs = new Map<string, Run>();

  constructor(
    private db: Db,
    private pool: SshPool,
  ) {}

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  preview(actionId: string, params: unknown) {
    return previewAction(actionId, params);
  }

  /** `record: false` skips history (used by "Test connection", which isn't something to learn from). */
  start(
    serverId: string,
    actionId: string,
    params: unknown,
    opts: { confirmed?: boolean; record?: boolean } = {},
  ): StartResult {
    const p = previewAction(actionId, params);
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
function execStep(client: Client, command: string, emit: (m: RunMsg) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      const out = new StringDecoder('utf8'); // never split a multi-byte character across chunks
      const errDec = new StringDecoder('utf8');
      const onClientClose = () => reject(new Error('The connection to the server was lost.'));
      client.once('close', onClientClose);
      stream.on('data', (d: Buffer) =>
        emit({ type: 'output', stream: 'stdout', text: out.write(d) }),
      );
      stream.stderr.on('data', (d: Buffer) =>
        emit({ type: 'output', stream: 'stderr', text: errDec.write(d) }),
      );
      stream.on('close', (code: number | null, signal?: string) => {
        client.off('close', onClientClose);
        const rest = out.end() + errDec.end();
        if (rest) emit({ type: 'output', stream: 'stdout', text: rest });
        resolve(code ?? (signal ? 128 : -1));
      });
    });
  });
}
