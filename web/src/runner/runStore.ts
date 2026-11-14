import { RunMsgSchema } from '@gfv/shared';
import { create } from 'zustand';
import { useLearn } from '../stores/learnStore';
import { useRecording } from '../stores/recordingStore';
import { toast } from '../stores/toastStore';

export interface RunRequest {
  serverId: string;
  actionId: string;
  params: unknown;
  /** Called when the run finishes (e.g. the File Manager refreshes its listing). */
  onDone?: (exitCode: number | null) => void;
  /** Reopen a run that is already going (after Hide): reattach to its output instead of starting it. */
  resumeRunId?: string;
}

/** A run that was started and has not finished yet (it keeps going on the server when its dialog is hidden). */
export interface ActiveRun {
  runId: string;
  serverId: string;
  actionId: string;
  startedAt: number;
  onDone?: (exitCode: number | null) => void;
}

/** Any app asks for a run with `requestRun(...)`; the RunDialog (mounted once in the Desktop) shows it. */
interface RunState {
  request: RunRequest | null;
  active: Record<string, ActiveRun>;
  close: () => void;
}

export const activeKey = (serverId: string, actionId: string) => `${serverId}:${actionId}`;

export const useRunDialog = create<RunState>((set) => ({
  request: null,
  active: {},
  close: () => set({ request: null }),
}));

export const requestRun = (req: RunRequest) => useRunDialog.setState({ request: req });

export const trackRun = (run: ActiveRun) =>
  useRunDialog.setState((s) => ({
    active: { ...s.active, [activeKey(run.serverId, run.actionId)]: run },
  }));

export function untrackRun(serverId: string, actionId: string): void {
  useRunDialog.setState((s) => {
    const { [activeKey(serverId, actionId)]: _gone, ...rest } = s.active;
    void _gone;
    return { active: rest };
  });
}

/**
 * The dialog was closed while the run goes on: keep a quiet socket open just to notice when it
 * finishes, so cards stop saying "Installing…" and lists refresh.
 */
export function watchRun(run: ActiveRun): void {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/api/runs/${run.runId}/stream`);
  let finished = false;
  const finish = (exitCode: number | null) => {
    if (finished) return;
    finished = true;
    untrackRun(run.serverId, run.actionId);
    run.onDone?.(exitCode);
    toast({
      kind: exitCode === 0 ? 'success' : 'error',
      title: exitCode === 0 ? 'A background task finished' : 'A background task failed',
      body: run.actionId + (exitCode === null || exitCode === 0 ? '' : ` (exit code ${exitCode})`),
    });
    void useLearn.getState().refresh();
    void useRecording.getState().refresh();
  };
  ws.onmessage = (e) => {
    try {
      const m = RunMsgSchema.safeParse(JSON.parse(String(e.data)));
      if (!m.success) return;
      if (m.data.type === 'done') finish(m.data.exitCode);
      else if (m.data.type === 'error') finish(null);
    } catch {
      /* ignore */
    }
  };
  ws.onclose = () => finish(null);
}
