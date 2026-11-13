import type { RunMsg } from '@gfv/shared';
import { RunMsgSchema } from '@gfv/shared';
import { useEffect, useRef, useState } from 'react';
import { CommandLine } from '../components/CommandLine';
import { RiskBadge } from '../components/RiskBadge';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { api, ApiError, type RunPreview } from '../lib/api';
import { useLearn } from '../stores/learnStore';
import { useRecording } from '../stores/recordingStore';
import { useServers } from '../stores/serverStore';
import {
  trackRun,
  untrackRun,
  useRunDialog,
  watchRun,
  type ActiveRun,
  type RunRequest,
} from './runStore';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'preview'; preview: RunPreview }
  | { kind: 'running'; preview: RunPreview }
  | {
      kind: 'finished';
      preview: RunPreview;
      exitCode: number | null;
      error?: string;
      cancelled?: 'user' | 'timeout';
    };

interface Block {
  command: string;
  chunks: { stream: 'stdout' | 'stderr'; text: string }[];
}

/** Shows the preview (explanation, exact commands, risk), asks for confirmation, then streams the run. */
export function RunDialogHost() {
  const request = useRunDialog((s) => s.request);
  const close = useRunDialog((s) => s.close);
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && close()}>
      {request && (
        <RunDialogBody
          key={JSON.stringify([request.serverId, request.actionId, request.params])}
          request={request}
          onClose={close}
        />
      )}
    </Dialog>
  );
}

function RunDialogBody({ request, onClose }: { request: RunRequest; onClose: () => void }) {
  const server = useServers((s) => s.servers.find((x) => x.id === request.serverId));
  const refreshLearn = useLearn((s) => s.refresh);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [understood, setUnderstood] = useState(false);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  // The run this dialog is showing, if it has not finished: when the dialog goes away (Hide, Esc),
  // the run keeps going on the server and a quiet watcher takes over.
  const activeRef = useRef<ActiveRun | null>(null);
  const outRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .previewRun(request.serverId, request.actionId, request.params)
      .then((preview) => {
        if (cancelled) return;
        if (request.resumeRunId) {
          const started = useRunDialog.getState().active[`${request.serverId}:${request.actionId}`];
          attach(request.resumeRunId, preview, started?.startedAt);
        } else setPhase({ kind: 'preview', preview });
      })
      .catch((e) => !cancelled && setPhase({ kind: 'error', message: describe(e) }));
    return () => {
      cancelled = true;
      wsRef.current?.close();
      if (activeRef.current) watchRun(activeRef.current);
    };
  }, [request]);

  useEffect(() => {
    if (phase.kind !== 'running') return;
    const base = activeRef.current?.startedAt ?? Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - base) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase.kind]);

  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight });
  }, [blocks]);

  const apply = (m: RunMsg, preview: RunPreview) => {
    if (m.type === 'step') setBlocks((b) => [...b, { command: m.command, chunks: [] }]);
    else if (m.type === 'output')
      setBlocks((b) => {
        if (!b.length) return b;
        const last = b[b.length - 1]!;
        return [
          ...b.slice(0, -1),
          { ...last, chunks: [...last.chunks, { stream: m.stream, text: m.text }] },
        ];
      });
    else if (m.type === 'done') {
      settle();
      setPhase({ kind: 'finished', preview, exitCode: m.exitCode, cancelled: m.cancelled });
      request.onDone?.(m.exitCode);
      void refreshLearn();
      void useRecording.getState().refresh();
    } else if (m.type === 'error') {
      settle();
      setPhase({ kind: 'finished', preview, exitCode: null, error: m.message });
      request.onDone?.(null);
      void refreshLearn();
      void useRecording.getState().refresh();
    }
  };

  /** The run ended: nothing left to watch in the background. */
  const settle = () => {
    activeRef.current = null;
    untrackRun(request.serverId, request.actionId);
  };

  /** Connect to a run's output stream (the server replays what was already printed). */
  const attach = (runId: string, preview: RunPreview, startedAt = Date.now()) => {
    const active: ActiveRun = {
      runId,
      serverId: request.serverId,
      actionId: request.actionId,
      startedAt,
      onDone: request.onDone,
    };
    activeRef.current = active;
    trackRun(active);
    setPhase({ kind: 'running', preview });
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/runs/${runId}/stream`);
    wsRef.current = ws;
    let finished = false;
    ws.onmessage = (e) => {
      const msg = RunMsgSchema.safeParse(JSON.parse(String(e.data)));
      if (!msg.success) return;
      if (msg.data.type === 'done' || msg.data.type === 'error') finished = true;
      apply(msg.data, preview);
    };
    ws.onclose = () => {
      if (!finished && wsRef.current === ws && activeRef.current)
        setPhase({
          kind: 'finished',
          preview,
          exitCode: null,
          error: 'Lost the connection to GFV.',
        });
    };
  };

  const cancel = async () => {
    const id = activeRef.current?.runId;
    if (!id) return;
    setCancelling(true);
    try {
      await api.cancelRun(id);
    } catch {
      /* it may just have finished */
    }
  };

  const run = async (preview: RunPreview) => {
    setPhase({ kind: 'running', preview });
    try {
      // The server enforces this too; `confirmed` here only says "the user saw the preview".
      const runId = await api.startRun(
        request.serverId,
        request.actionId,
        request.params,
        preview.risk !== 'safe',
      );
      attach(runId, preview);
    } catch (e) {
      setPhase({ kind: 'error', message: describe(e) });
    }
  };

  const preview = 'preview' in phase ? phase.preview : undefined;
  const needsConfirm = preview && preview.risk !== 'safe';

  return (
    <DialogContent className="max-w-2xl" aria-describedby={undefined}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {preview?.title ?? 'Preparing…'}
          {preview && <RiskBadge risk={preview.risk} />}
        </DialogTitle>
        <DialogDescription>
          {server ? `On ${server.name} (${server.username}@${server.host})` : 'Server not found'}
        </DialogDescription>
      </DialogHeader>

      {phase.kind === 'loading' && (
        <p className="text-sm text-muted-foreground">Loading preview…</p>
      )}
      {phase.kind === 'error' && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {phase.message}
        </p>
      )}

      {preview && phase.kind === 'preview' && (
        <>
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              What this does
            </h3>
            <p className="text-sm">{preview.explain}</p>
          </section>
          <section className="flex flex-col gap-1.5">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">
              Commands GFV will run
            </h3>
            {preview.commands.map((c, i) => (
              <CommandLine key={i} command={c} serverId={request.serverId} onTried={onClose} />
            ))}
          </section>
          {preview.reasons.length > 0 && (
            <section
              className={`rounded border p-3 text-sm ${
                preview.risk === 'danger'
                  ? 'border-red-500 bg-red-500/10'
                  : 'border-amber-500 bg-amber-500/10'
              }`}
            >
              <p className="mb-1 font-semibold">
                {preview.risk === 'danger'
                  ? '⛔ This can seriously damage the server'
                  : '⚠️ Be careful'}
              </p>
              <ul className="list-disc pl-5">
                {preview.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {preview.matches
                .filter((m) => m.safer)
                .map((m) => (
                  <p key={m.id} className="mt-1 text-xs opacity-80">
                    Safer: {m.safer}
                  </p>
                ))}
              <label className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={understood}
                  onChange={(e) => setUnderstood(e.target.checked)}
                />
                I understand the risk
              </label>
            </section>
          )}
        </>
      )}

      {blocks.length > 0 && (
        <div
          ref={outRef}
          aria-label="Output"
          className="max-h-64 overflow-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-100"
        >
          {blocks.map((b, i) => (
            <div key={i} className="mb-2">
              <div className="text-sky-300">$ {b.command}</div>
              {b.chunks.map((c, j) => (
                <span
                  key={j}
                  className={`whitespace-pre-wrap break-all ${c.stream === 'stderr' ? 'text-red-300' : ''}`}
                >
                  {c.text}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

      {phase.kind === 'running' && (
        <div className="text-sm text-muted-foreground">
          <p>
            {cancelling ? 'Stopping…' : 'Running…'} {Math.floor(elapsed / 60)}:
            {String(elapsed % 60).padStart(2, '0')}
          </p>
          {phase.preview.longRunning && (
            <p className="mt-1 text-xs">
              You can hide this window: it keeps running. Cancelling in the middle of an install can
              leave the package system locked; if the next install complains about dpkg, run{' '}
              <code>sudo dpkg --configure -a</code>.
            </p>
          )}
        </div>
      )}
      {phase.kind === 'finished' && (
        <p
          role="status"
          className={`text-sm font-medium ${phase.exitCode === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
        >
          {phase.error
            ? phase.error
            : phase.cancelled === 'timeout'
              ? '■ Stopped: it ran for more than 30 minutes.'
              : phase.cancelled === 'user'
                ? '■ Cancelled.'
                : phase.exitCode === 0
                  ? '✓ Finished successfully (exit code 0)'
                  : `✗ Failed (exit code ${phase.exitCode}). Later commands were skipped.`}
        </p>
      )}

      <DialogFooter>
        {phase.kind === 'preview' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant={phase.preview.risk === 'danger' ? 'destructive' : 'default'}
              disabled={!!needsConfirm && !understood}
              onClick={() => void run(phase.preview)}
            >
              {phase.preview.risk === 'safe' ? 'Run' : 'Run anyway'}
            </Button>
          </>
        ) : phase.kind === 'running' && phase.preview.longRunning ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Hide
            </Button>
            <Button variant="destructive" disabled={cancelling} onClick={() => void cancel()}>
              {cancelling ? 'Stopping…' : 'Cancel'}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

function describe(e: unknown): string {
  if (e instanceof ApiError) {
    const b = e.body as { error?: string };
    if (b?.error === 'not_connected')
      return 'This server is not connected. Connect it in the Servers app first.';
    if (b?.error === 'confirmation_required') return 'GFV needs your confirmation for this action.';
    return e.detail;
  }
  return 'Could not reach the GFV server.';
}
