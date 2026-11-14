import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import {
  actionById,
  jobStatus,
  maxRisk,
  resolveValues,
  substitute,
  type JobDecision,
  type JobMsg,
  type JobSnapshot,
  type Plan,
  type RecipeParam,
  type StepState,
  type TargetState,
} from '@gfv/shared';
import type { Db } from '../../db/index.js';
import { jobs } from '../../db/schema.js';
import type { Runner } from '../runner/runner.js';
import type { RecipeService } from '../recipes/recipes.js';

/** What a job needs from the Command Runner (so tests can fake it). */
export type JobRunner = Pick<Runner, 'preview' | 'start' | 'cancel'>;

export interface Step {
  actionId: string;
  params: unknown;
}

export type JobError =
  | { error: 'recipe_not_found' }
  | { error: 'no_steps' }
  | { error: 'missing_params'; missing: string[] }
  | { error: 'invalid_steps'; problems: string[] }
  | { error: 'not_connected'; serverIds: string[] }
  | { error: 'confirmation_required'; risk: 'caution' | 'danger' };

interface SourceInput {
  kind: 'replay' | 'broadcast';
  serverIds: string[];
  recipeId?: string;
  steps?: { actionId: string; params?: unknown }[];
  values?: Record<string, string>;
}

/** Max output kept per target for viewers that connect late. */
const MAX_REPLAY_CHARS = 256 * 1024;
const KEEP_FINISHED_MS = 30 * 60_000;

class TargetRuntime {
  decision?: (d: JobDecision) => void;
  runId?: string;
  state: TargetState;
  constructor(
    readonly serverId: string,
    readonly steps: Step[],
  ) {
    this.state = {
      serverId,
      status: 'pending',
      current: 0,
      steps: steps.map((s) => ({
        actionId: s.actionId,
        title: actionById(s.actionId)?.title ?? s.actionId,
        status: 'pending',
      })),
    };
  }
}

/** One replay/broadcast in flight. Keeps its messages so a viewer that connects late sees everything. */
export class Job {
  readonly id = randomUUID();
  readonly startedAt = Date.now();
  finishedAt: number | null = null;
  cancelled = false;
  readonly targets: TargetRuntime[];
  private subs = new Set<(m: JobMsg) => void>();
  private output: JobMsg[] = [];
  private outputChars = 0;
  readonly done: Promise<void>;
  private finish!: () => void;

  constructor(
    readonly kind: 'replay' | 'broadcast',
    readonly name: string,
    targets: TargetRuntime[],
  ) {
    this.targets = targets;
    this.done = new Promise((r) => (this.finish = r));
  }

  snapshot(): JobSnapshot {
    const targets = this.targets.map((t) => ({
      ...t.state,
      steps: t.state.steps.map((s) => ({ ...s })),
    }));
    return {
      id: this.id,
      kind: this.kind,
      name: this.name,
      status: jobStatus(targets),
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      targets,
    };
  }

  /** Tell viewers the state changed. */
  changed(): void {
    const job = this.snapshot();
    if (job.status !== 'running' && this.finishedAt === null) {
      this.finishedAt = Date.now();
      job.finishedAt = this.finishedAt;
    }
    for (const s of this.subs) s({ type: 'snapshot', job });
    if (job.status !== 'running') this.finish();
  }

  emitOutput(m: Extract<JobMsg, { type: 'output' }>): void {
    if (this.outputChars < MAX_REPLAY_CHARS * this.targets.length) {
      this.output.push(m);
      this.outputChars += m.text.length;
    }
    for (const s of this.subs) s(m);
  }

  /** Replays the output so far, then the current state, then streams live. */
  subscribe(fn: (m: JobMsg) => void): () => void {
    for (const m of this.output) fn(m);
    fn({ type: 'snapshot', job: this.snapshot() });
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}

export class JobService {
  private live = new Map<string, Job>();

  constructor(
    private db: Db,
    private runner: JobRunner,
    private recipes: Pick<RecipeService, 'get'>,
    /** Is this server connected right now? */
    private connected: (serverId: string) => boolean,
  ) {}

  get(id: string): Job | undefined {
    return this.live.get(id);
  }

  /** Newest first: live jobs, then finished ones from the database. */
  list(limit = 50): JobSnapshot[] {
    const liveOnes = [...this.live.values()].map((j) => j.snapshot());
    const liveIds = new Set(liveOnes.map((j) => j.id));
    const stored = this.db
      .select()
      .from(jobs)
      .orderBy(desc(jobs.startedAt))
      .limit(limit)
      .all()
      .filter((r) => !liveIds.has(r.id))
      .map((r) => r.snapshot as JobSnapshot);
    return [...liveOnes, ...stored].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  }

  // ---- planning ---------------------------------------------------------------------------

  /** The steps (placeholders filled in) and name, or what is wrong. Pure of side effects. */
  private resolve(
    src: SourceInput,
  ): { ok: true; steps: Step[]; name: string; secret: boolean } | { ok: false; err: JobError } {
    let raw: Step[];
    let params: RecipeParam[] = [];
    let name: string;
    if (src.recipeId) {
      const r = this.recipes.get(src.recipeId);
      if (!r) return { ok: false, err: { error: 'recipe_not_found' } };
      raw = r.steps.map((s) => ({ actionId: s.actionId, params: s.params }));
      params = r.params;
      name = `Replay: ${r.name}`;
    } else {
      raw = (src.steps ?? []).map((s) => ({ actionId: s.actionId, params: s.params ?? {} }));
      name =
        raw.length === 1 ? (actionById(raw[0]!.actionId)?.title ?? raw[0]!.actionId) : 'Broadcast';
      if (raw.length === 1) name = `Broadcast: ${name}`;
    }
    if (raw.length === 0) return { ok: false, err: { error: 'no_steps' } };
    const v = resolveValues(params, src.values ?? {});
    if (!v.ok) return { ok: false, err: { error: 'missing_params', missing: v.missing } };
    const steps = raw.map((s) => ({
      actionId: s.actionId,
      params: substitute(s.params, v.values),
    }));
    return { ok: true, steps, name, secret: params.some((p) => p.secret) };
  }

  /** What WOULD run on each target: the exact commands (they differ by server: root or sudo), and the risk. */
  async plan(src: SourceInput): Promise<Plan | JobError> {
    const r = this.resolve(src);
    if (!r.ok) {
      // Missing values still get a plan-less answer so the UI can ask for them.
      if (r.err.error === 'missing_params')
        return { name: '', missing: r.err.missing, risk: 'safe', targets: [] };
      return r.err;
    }
    const risks: Array<'safe' | 'caution' | 'danger'> = [];
    const targets: Plan['targets'] = [];
    for (const serverId of src.serverIds) {
      const steps: Plan['targets'][number]['steps'] = [];
      for (const s of r.steps) {
        const p = await this.runner.preview(serverId, s.actionId, s.params);
        if (p.ok) {
          steps.push({ ok: true, preview: p.preview });
          risks.push(p.preview.risk);
        } else {
          steps.push({
            ok: false,
            actionId: s.actionId,
            error:
              p.error === 'unknown_action'
                ? 'This action does not exist in this version of GFV.'
                : p.error === 'invalid_params'
                  ? `Invalid parameters: ${p.issues.map((i) => i.message).join('; ')}`
                  : 'This step cannot run.',
          });
        }
      }
      targets.push({ serverId, connected: this.connected(serverId), steps });
    }
    return { name: r.name, missing: [], risk: maxRisk(risks), targets };
  }

  // ---- running ----------------------------------------------------------------------------

  async create(
    src: SourceInput & { name?: string; confirmed?: boolean },
  ): Promise<{ ok: true; job: Job } | { ok: false; err: JobError }> {
    const r = this.resolve(src);
    if (!r.ok) return r;
    const plan = await this.plan(src);
    if ('error' in plan) return { ok: false, err: plan };
    const bad = plan.targets.flatMap((t) =>
      t.steps.filter((s) => !s.ok).map((s) => (s.ok ? '' : s.error)),
    );
    if (bad.length)
      return { ok: false, err: { error: 'invalid_steps', problems: [...new Set(bad)] } };
    const offline = src.serverIds.filter((id) => !this.connected(id));
    if (offline.length) return { ok: false, err: { error: 'not_connected', serverIds: offline } };
    // The Safety Net lives here, not in the UI: one confirmation covers the whole plan the user reviewed.
    if (plan.risk !== 'safe' && !src.confirmed)
      return { ok: false, err: { error: 'confirmation_required', risk: plan.risk } };

    const job = new Job(
      src.kind,
      src.name ?? r.name,
      src.serverIds.map((id) => new TargetRuntime(id, r.steps)),
    );
    this.live.set(job.id, job);
    job.changed();
    void Promise.all(job.targets.map((t) => this.runTarget(job, t, r.secret))).then(() => {
      job.changed();
      this.persist(job);
      setTimeout(() => this.live.delete(job.id), KEEP_FINISHED_MS).unref();
    });
    return { ok: true, job };
  }

  /** Answer a paused target. */
  decide(jobId: string, serverId: string, decision: JobDecision): boolean {
    const t = this.live.get(jobId)?.targets.find((x) => x.serverId === serverId);
    if (!t?.decision) return false;
    const fn = t.decision;
    t.decision = undefined;
    fn(decision);
    return true;
  }

  /** Stop everything: running steps get Ctrl-C, paused targets are abandoned, waiting ones never start. */
  cancel(jobId: string): boolean {
    const job = this.live.get(jobId);
    if (!job || job.finishedAt !== null) return false;
    job.cancelled = true;
    for (const t of job.targets) {
      if (t.runId) this.runner.cancel(t.runId);
      t.decision?.('abort');
    }
    return true;
  }

  private async runTarget(job: Job, t: TargetRuntime, secret: boolean): Promise<void> {
    const st = t.state;
    for (let i = 0; i < t.steps.length; i++) {
      const step = t.steps[i]!;
      const s = st.steps[i]!;
      st.current = i;
      for (;;) {
        if (job.cancelled) return this.markCancelled(job, t, i);
        st.status = 'running';
        s.status = 'running';
        delete s.error;
        s.exitCode = undefined;
        job.changed();

        const failure = await this.runStep(job, t, i, step, secret);
        if (!failure) {
          s.status = 'ok';
          break;
        }
        if (job.cancelled) {
          s.status = 'failed';
          return this.markCancelled(job, t, i);
        }
        // Pause on failure: ask what to do. The other targets keep going.
        s.status = 'failed';
        if (failure.error) s.error = failure.error;
        s.exitCode = failure.exitCode;
        st.status = 'paused';
        job.changed();
        const decision = await new Promise<JobDecision>((resolve) => (t.decision = resolve));
        if (job.cancelled || decision === 'abort') {
          if (job.cancelled) return this.markCancelled(job, t, i, true);
          st.status = 'failed';
          for (let k = i + 1; k < st.steps.length; k++) st.steps[k]!.status = 'pending';
          job.changed();
          return;
        }
        if (decision === 'skip') {
          s.status = 'skipped';
          break;
        }
        // 'retry': loop again
      }
    }
    st.status = 'done';
    job.changed();
  }

  private markCancelled(job: Job, t: TargetRuntime, from: number, keepFailed = false): void {
    t.state.status = 'cancelled';
    t.state.steps.forEach((s, k) => {
      if (k > from || (k === from && !keepFailed && s.status === 'running')) s.status = 'pending';
    });
    job.changed();
  }

  /** Run one step through the Command Runner. Returns null on success, else why it failed. */
  private async runStep(
    job: Job,
    t: TargetRuntime,
    index: number,
    step: Step,
    secret: boolean,
  ): Promise<{ exitCode: number | null; error?: string } | null> {
    // One confirmation covered the whole plan (checked in create()). Steps are not recorded into a recording,
    // and with secret parameters nothing at all is written to history (values could appear in it).
    const r = await this.runner.start(t.serverId, step.actionId, step.params, {
      confirmed: true,
      record: !secret,
      recordStep: false,
    });
    if (!r.ok) {
      const msg =
        r.error === 'not_connected'
          ? 'The server is not connected.'
          : r.error === 'invalid_params'
            ? `Invalid parameters: ${r.issues.map((i) => i.message).join('; ')}`
            : r.error;
      return { exitCode: null, error: msg };
    }
    t.runId = r.run.id;
    let error: string | undefined;
    const unsub = r.run.subscribe((m) => {
      if (m.type === 'output')
        job.emitOutput({
          type: 'output',
          serverId: t.serverId,
          step: index,
          stream: m.stream,
          text: m.text,
        });
      else if (m.type === 'error') error = m.message;
    });
    await r.run.done;
    unsub();
    t.runId = undefined;
    const code = r.run.exitCode;
    if (code === 0) return null;
    return { exitCode: code, ...(error ? { error } : {}) };
  }

  private persist(job: Job): void {
    const snap = job.snapshot();
    try {
      this.db
        .insert(jobs)
        .values({
          id: job.id,
          kind: job.kind,
          name: job.name,
          status: snap.status,
          snapshot: snap,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
        })
        .onConflictDoUpdate({
          target: jobs.id,
          set: { status: snap.status, snapshot: snap, finishedAt: job.finishedAt },
        })
        .run();
    } catch {
      /* history is best effort */
    }
  }

  /** Remove a finished job from the history. */
  remove(id: string): boolean {
    if (this.live.get(id)?.finishedAt === null) return false;
    this.live.delete(id);
    return this.db.delete(jobs).where(eq(jobs.id, id)).run().changes > 0;
  }
}

export type { StepState };
