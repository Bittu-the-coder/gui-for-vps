import type { JobSnapshot, StepStatus, TargetState, TargetStatus } from '@gfv/shared';
import {
  CircleCheck,
  CircleMinus,
  CirclePause,
  CircleX,
  Circle,
  LoaderCircle,
  RotateCcw,
  SkipForward,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { confirmDialog } from '../../components/confirmStore';
import { Button } from '../../components/ui/button';
import { usePolling } from '../../hooks/usePolling';
import { api } from '../../lib/api';
import { outputKey, useJobs } from '../../stores/jobStore';
import { useServers } from '../../stores/serverStore';
import { toast } from '../../stores/toastStore';
import { PlanDialog } from './PlanDialog';

const STEP_ICON: Record<StepStatus, React.ReactNode> = {
  pending: <Circle size={14} className="text-faint-foreground" />,
  running: <LoaderCircle size={14} className="animate-spin text-link" />,
  ok: <CircleCheck size={14} className="text-success" />,
  failed: <CircleX size={14} className="text-danger" />,
  skipped: <CircleMinus size={14} className="text-muted-foreground" />,
};

const TARGET_LABEL: Record<TargetStatus, string> = {
  pending: 'Waiting',
  running: 'Running',
  paused: 'Needs a decision',
  done: 'Done',
  failed: 'Stopped',
  cancelled: 'Cancelled',
};
const TARGET_TONE: Record<TargetStatus, string> = {
  pending: 'text-muted-foreground',
  running: 'text-link',
  paused: 'text-warning',
  done: 'text-success',
  failed: 'text-danger',
  cancelled: 'text-muted-foreground',
};

function jobTone(j: JobSnapshot) {
  return j.status === 'running'
    ? 'text-link'
    : j.status === 'done'
      ? 'text-success'
      : j.status === 'failed'
        ? 'text-danger'
        : 'text-muted-foreground';
}

/** Replays and broadcasts: progress per server, and what to do when a step fails. */
export function JobsApp() {
  const jobs = useJobs((s) => s.jobs);
  const output = useJobs((s) => s.output);
  const setJobs = useJobs((s) => s.setJobs);
  const servers = useServers((s) => s.servers);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<{ serverId: string; step: number } | null>(null);
  const [broadcast, setBroadcast] = useState(false);

  const list = Object.values(jobs).sort((a, b) => b.startedAt - a.startedAt);
  const anyRunning = list.some((j) => j.status === 'running');
  // The list comes from the server (it includes finished jobs from earlier sessions); live ones are streamed.
  usePolling(async () => setJobs(await api.jobs()), anyRunning ? 2000 : 8000);
  // Follow the newest job: when you start one (the Jobs window may already be open on an old job), it is shown.
  const newest = list[0]?.id;
  useEffect(() => {
    if (newest) {
      setSelected(newest);
      setView(null);
    }
  }, [newest]);

  const job = selected ? jobs[selected] : undefined;
  const name = (id: string) => servers.find((s) => s.id === id)?.name ?? id;
  const color = (id: string) => servers.find((s) => s.id === id)?.color ?? '#888';

  const decide = (t: TargetState, d: 'retry' | 'skip' | 'abort') =>
    job &&
    api
      .decideJob(job.id, t.serverId, d)
      .catch(() => toast({ kind: 'error', title: 'That server is no longer waiting' }));

  const cancel = async () => {
    if (!job) return;
    const ok = await confirmDialog({
      title: 'Cancel this job?',
      body: 'Steps that are running get Ctrl-C. Steps that already finished are not undone.',
      confirmLabel: 'Cancel job',
      danger: true,
    });
    if (ok) await api.cancelJob(job.id).catch(() => {});
  };
  const remove = async () => {
    if (!job) return;
    await api.deleteJob(job.id).catch(() => {});
    useJobs.setState((s) => {
      const { [job.id]: _gone, ...rest } = s.jobs;
      void _gone;
      return { jobs: rest };
    });
    setSelected(null);
  };

  return (
    <div className="flex h-full text-body">
      <div className="flex w-60 shrink-0 flex-col border-r border-border bg-sunken">
        <div className="border-b border-border p-2">
          <Button size="sm" className="w-full" onClick={() => setBroadcast(true)}>
            New broadcast…
          </Button>
        </div>
        <ul className="min-h-0 flex-1 overflow-auto p-1">
          {list.length === 0 && (
            <li className="p-3 text-center text-footnote text-muted-foreground">
              Nothing yet. Run a recipe on other servers from the Recipes app, or start a broadcast.
            </li>
          )}
          {list.map((j) => (
            <li key={j.id}>
              <button
                data-testid="job-row"
                onClick={() => {
                  setSelected(j.id);
                  setView(null);
                }}
                className={`flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-accent ${selected === j.id ? 'bg-primary/15' : ''}`}
              >
                <span className="truncate font-medium">{j.name}</span>
                <span className={`text-caption ${jobTone(j)}`}>
                  {j.status === 'running'
                    ? 'Running'
                    : j.status === 'done'
                      ? 'Finished'
                      : j.status === 'failed'
                        ? 'Finished with problems'
                        : 'Cancelled'}{' '}
                  · {j.targets.length} server{j.targets.length === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {!job ? (
          <div className="grid flex-1 place-items-center p-4 text-center text-muted-foreground">
            Pick a job.
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-title font-semibold">{job.name}</h2>
                <p className="text-caption text-muted-foreground">
                  Started {new Date(job.startedAt).toLocaleTimeString()}
                  {job.finishedAt
                    ? `, finished ${new Date(job.finishedAt).toLocaleTimeString()}`
                    : ''}
                </p>
              </div>
              {job.status === 'running' ? (
                <Button size="sm" variant="outline" onClick={() => void cancel()}>
                  Cancel job
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  onClick={() => void remove()}
                >
                  Remove
                </Button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              <ul className="flex flex-col gap-2">
                {job.targets.map((t) => {
                  const done = t.steps.filter(
                    (s) => s.status === 'ok' || s.status === 'skipped',
                  ).length;
                  return (
                    <li
                      key={t.serverId}
                      data-testid="job-target"
                      data-status={t.status}
                      className="rounded-xl border border-separator bg-background p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{ background: color(t.serverId) }}
                        />
                        <span className="font-medium">{name(t.serverId)}</span>
                        <span className={`text-footnote font-medium ${TARGET_TONE[t.status]}`}>
                          {TARGET_LABEL[t.status]}
                        </span>
                        <span className="ml-auto text-footnote text-muted-foreground">
                          {done}/{t.steps.length} steps
                        </span>
                      </div>
                      <div
                        className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10"
                        role="progressbar"
                        aria-label={`${name(t.serverId)} progress`}
                        aria-valuemin={0}
                        aria-valuemax={t.steps.length}
                        aria-valuenow={done}
                      >
                        <div
                          className={`h-full ${t.status === 'failed' || t.status === 'paused' ? 'bg-warning' : 'bg-primary'}`}
                          style={{ width: `${(done / Math.max(1, t.steps.length)) * 100}%` }}
                        />
                      </div>
                      <ol className="mt-2 flex flex-col gap-0.5">
                        {t.steps.map((s, i) => (
                          <li key={i}>
                            <button
                              className={`flex w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left hover:bg-accent ${view?.serverId === t.serverId && view.step === i ? 'bg-accent' : ''}`}
                              onClick={() => setView({ serverId: t.serverId, step: i })}
                            >
                              {STEP_ICON[s.status]}
                              <span className="flex-1 truncate">{s.title}</span>
                              {s.exitCode ? (
                                <span className="text-caption text-danger">exit {s.exitCode}</span>
                              ) : null}
                            </button>
                            {s.error && <p className="pl-7 text-caption text-danger">{s.error}</p>}
                          </li>
                        ))}
                      </ol>
                      {t.status === 'paused' && (
                        <div
                          role="alert"
                          className="mt-2 rounded-lg border border-warning bg-warning/10 p-2"
                        >
                          <p className="flex items-center gap-1.5 font-medium">
                            <CirclePause size={14} className="text-warning" /> “
                            {t.steps[t.current]?.title}” failed on {name(t.serverId)}.
                          </p>
                          <p className="mt-0.5 text-footnote text-muted-foreground">
                            Later steps are on hold. Look at the output below, then choose.
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => void decide(t, 'retry')}>
                              <RotateCcw size={13} /> Retry step
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void decide(t, 'skip')}
                            >
                              <SkipForward size={13} /> Skip step
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-danger"
                              onClick={() => void decide(t, 'abort')}
                            >
                              Stop this server
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {(() => {
                const v =
                  view ??
                  (job.targets.find((t) => t.status === 'paused')
                    ? {
                        serverId: job.targets.find((t) => t.status === 'paused')!.serverId,
                        step: job.targets.find((t) => t.status === 'paused')!.current,
                      }
                    : null);
                if (!v) return null;
                const text = output[outputKey(job.id, v.serverId, v.step)];
                return (
                  <section className="mt-3" aria-label="Output">
                    <h3 className="mb-1 text-caption font-semibold uppercase tracking-wide text-faint-foreground">
                      Output · {name(v.serverId)} · step {v.step + 1}
                    </h3>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-code p-2 font-mono text-caption text-code-foreground">
                      {text ??
                        'No output was kept for this step (it may have finished before you opened the Jobs app).'}
                    </pre>
                  </section>
                );
              })()}
            </div>
          </>
        )}
      </div>
      {broadcast && (
        <PlanDialog source={{ kind: 'broadcast' }} onClose={() => setBroadcast(false)} />
      )}
    </div>
  );
}
