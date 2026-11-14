import { JobMsgSchema, type JobSnapshot } from '@gfv/shared';
import { create } from 'zustand';
import { toast } from './toastStore';
import { useServers } from './serverStore';

/** Live state of replays and broadcasts, fed by their WebSocket streams, plus the output of each step. */
interface JobState {
  jobs: Record<string, JobSnapshot>;
  /** Output per `${jobId}|${serverId}|${stepIndex}`, capped. */
  output: Record<string, string>;
  /** Start following a job (streams its state, announces pauses and the end). */
  watch: (jobId: string, onOpenJobs?: () => void) => void;
  setJobs: (jobs: JobSnapshot[]) => void;
}

const MAX_OUTPUT = 200_000;
const watching = new Set<string>();
export const outputKey = (jobId: string, serverId: string, step: number) =>
  `${jobId}|${serverId}|${step}`;

const serverName = (id: string) =>
  useServers.getState().servers.find((s) => s.id === id)?.name ?? 'A server';

/** Announce what changed: a target that just paused (needs you), or the job ending. Pure, so it is testable. */
export function jobAnnouncements(
  prev: JobSnapshot | undefined,
  next: JobSnapshot,
  name: (id: string) => string,
) {
  const out: { kind: 'error' | 'success' | 'info'; title: string; body?: string }[] = [];
  for (const t of next.targets) {
    const before = prev?.targets.find((x) => x.serverId === t.serverId)?.status;
    if (t.status === 'paused' && before !== 'paused') {
      const step = t.steps[t.current];
      out.push({
        kind: 'error',
        title: `${name(t.serverId)} needs a decision`,
        body: `“${step?.title ?? 'A step'}” failed. Retry it, skip it or stop that server.`,
      });
    }
  }
  if (prev && prev.status === 'running' && next.status !== 'running') {
    const ok = next.targets.filter((t) => t.status === 'done').length;
    out.push({
      kind: next.status === 'done' ? 'success' : next.status === 'cancelled' ? 'info' : 'error',
      title:
        next.status === 'done'
          ? `${next.name} finished`
          : next.status === 'cancelled'
            ? `${next.name} was cancelled`
            : `${next.name} finished with problems`,
      body: `${ok} of ${next.targets.length} server${next.targets.length === 1 ? '' : 's'} completed.`,
    });
  }
  return out;
}

export const useJobs = create<JobState>((set, get) => ({
  jobs: {},
  output: {},
  setJobs: (list) =>
    set((s) => {
      const jobs = { ...s.jobs };
      for (const j of list) if (!watching.has(j.id) || !jobs[j.id]) jobs[j.id] = j;
      return { jobs };
    }),
  watch: (jobId, onOpenJobs) => {
    if (watching.has(jobId)) return;
    watching.add(jobId);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/jobs/${jobId}/stream`);
    ws.onmessage = (e) => {
      const m = JobMsgSchema.safeParse(safeJson(e.data));
      if (!m.success) return;
      if (m.data.type === 'output') {
        const { serverId, step, text } = m.data; // (narrowing is lost inside the callback below)
        const key = outputKey(jobId, serverId, step);
        set((s) => ({
          output: { ...s.output, [key]: ((s.output[key] ?? '') + text).slice(-MAX_OUTPUT) },
        }));
        return;
      }
      const prev = get().jobs[jobId];
      const next = m.data.job;
      set((s) => ({ jobs: { ...s.jobs, [jobId]: next } }));
      for (const a of jobAnnouncements(prev, next, serverName))
        toast({ ...a, ...(onOpenJobs ? { action: { label: 'Open Jobs', run: onOpenJobs } } : {}) });
      if (next.status !== 'running') {
        watching.delete(jobId);
        ws.close();
      }
    };
    ws.onclose = () => watching.delete(jobId);
  },
}));

function safeJson(s: unknown): unknown {
  try {
    return JSON.parse(String(s));
  } catch {
    return undefined;
  }
}
