import { describe, expect, it, vi } from 'vitest';
import type { JobSnapshot, RecipeDetail } from '@gfv/shared';
import { openDb } from '../../db/index.js';
import { JobService, type JobRunner } from './jobs.js';

/**
 * The job state machine, with a scripted fake Command Runner so failures are forced, not hoped for.
 * (The real thing against real servers is in ssh/jobs.int.test.ts.)
 */

type Outcome = number | 'hang';
function fakeRunner(script: (serverId: string, actionId: string, n: number) => Outcome) {
  const calls: { serverId: string; actionId: string; params: unknown; opts: unknown }[] = [];
  const counts = new Map<string, number>();
  const cancelled: string[] = [];
  const pending = new Map<string, () => void>();
  const runner: JobRunner = {
    preview: vi.fn(async (_s, actionId, params) => {
      // `system.uptime` is a real safe action; anything else is reported as what the test says.
      return {
        ok: true as const,
        preview: {
          actionId,
          title: actionId,
          explain: '',
          commands: [`echo ${JSON.stringify(params)}`],
          risk: actionId.startsWith('danger')
            ? ('danger' as const)
            : actionId.startsWith('care')
              ? ('caution' as const)
              : ('safe' as const),
          reasons: [],
          longRunning: false,
          snapshots: [],
          matches: [],
        },
        params,
      };
    }) as unknown as JobRunner['preview'],
    start: vi.fn(async (serverId, actionId, params, opts) => {
      calls.push({ serverId, actionId, params, opts });
      const key = `${serverId}:${actionId}`;
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      const outcome = script(serverId, actionId, n);
      const id = `run-${calls.length}`;
      let resolve!: () => void;
      const done = new Promise<void>((r) => (resolve = r));
      const run = {
        id,
        exitCode: null as number | null,
        done,
        subscribe(fn: (m: unknown) => void) {
          fn({ type: 'output', stream: 'stdout', text: `out ${key} #${n}\n` });
          return () => {};
        },
      };
      if (outcome === 'hang')
        pending.set(id, () => {
          run.exitCode = 130;
          resolve();
        });
      else
        queueMicrotask(() => {
          run.exitCode = outcome;
          resolve();
        });
      return { ok: true as const, run, preview: {} };
    }) as unknown as JobRunner['start'],
    cancel: vi.fn((id: string) => {
      cancelled.push(id);
      pending.get(id)?.();
      return true;
    }),
  };
  return { runner, calls, cancelled };
}

const recipe = (
  steps: { actionId: string; params?: unknown }[],
  params: RecipeDetail['params'] = [],
): RecipeDetail => ({
  id: 'r1',
  name: 'My recipe',
  serverId: null,
  createdAt: 0,
  updatedAt: 0,
  stepCount: steps.length,
  params,
  steps: steps.map((s, i) => ({
    id: `s${i}`,
    position: i,
    actionId: s.actionId,
    params: s.params ?? {},
    createdAt: 0,
  })),
});

function setup(
  script: Parameters<typeof fakeRunner>[0],
  r: RecipeDetail,
  connected: (id: string) => boolean = () => true,
) {
  const f = fakeRunner(script);
  const svc = new JobService(
    openDb(':memory:'),
    f.runner,
    { get: (id) => (id === r.id ? r : undefined) },
    connected,
  );
  return { ...f, svc };
}
const settle = () => new Promise((r) => setTimeout(r, 15));
const target = (j: JobSnapshot, id: string) => j.targets.find((t) => t.serverId === id)!;

describe('JobService: replay', () => {
  it('runs every step in order on every target, in parallel, and finishes "done"', async () => {
    const t = setup(() => 0, recipe([{ actionId: 'a1' }, { actionId: 'a2' }]));
    const r = await t.svc.create({ kind: 'replay', serverIds: ['s1', 's2'], recipeId: 'r1' });
    if (!r.ok) throw new Error('create failed');
    await r.job.done;
    const snap = r.job.snapshot();
    expect(snap.status).toBe('done');
    for (const id of ['s1', 's2']) {
      expect(target(snap, id).steps.map((s) => s.status)).toEqual(['ok', 'ok']);
    }
    // Within a target the order is a1 then a2.
    const order = (id: string) => t.calls.filter((c) => c.serverId === id).map((c) => c.actionId);
    expect(order('s1')).toEqual(['a1', 'a2']);
    expect(order('s2')).toEqual(['a1', 'a2']);
  });

  it('job steps are never recorded into a recording, and are confirmed server-side', async () => {
    const t = setup(() => 0, recipe([{ actionId: 'a1' }]));
    const r = await t.svc.create({ kind: 'replay', serverIds: ['s1'], recipeId: 'r1' });
    if (!r.ok) throw new Error();
    await r.job.done;
    expect(t.calls[0]!.opts).toMatchObject({ recordStep: false, confirmed: true });
  });

  it('a failed step pauses ONLY that target; the others carry on', async () => {
    const t = setup(
      (s, a) => (s === 's1' && a === 'a1' ? 1 : 0),
      recipe([{ actionId: 'a1' }, { actionId: 'a2' }]),
    );
    const r = await t.svc.create({ kind: 'replay', serverIds: ['s1', 's2'], recipeId: 'r1' });
    if (!r.ok) throw new Error();
    await settle();
    const snap = r.job.snapshot();
    expect(snap.status).toBe('running');
    expect(target(snap, 's1').status).toBe('paused');
    expect(target(snap, 's1').steps[0]).toMatchObject({ status: 'failed', exitCode: 1 });
    expect(target(snap, 's2').status).toBe('done');
    expect(t.calls.some((c) => c.serverId === 's1' && c.actionId === 'a2')).toBe(false); // nothing ran past the failure
    t.svc.decide(r.job.id, 's1', 'abort');
    await r.job.done;
    expect(r.job.snapshot().status).toBe('failed');
  });

  it('retry runs the failed step again, and success lets the target finish', async () => {
    const t = setup(
      (_s, a, n) => (a === 'a1' && n === 1 ? 2 : 0),
      recipe([{ actionId: 'a1' }, { actionId: 'a2' }]),
    );
    const r = await t.svc.create({ kind: 'replay', serverIds: ['s1'], recipeId: 'r1' });
    if (!r.ok) throw new Error();
    await settle();
    expect(target(r.job.snapshot(), 's1').status).toBe('paused');
    expect(t.svc.decide(r.job.id, 's1', 'retry')).toBe(true);
    await r.job.done;
    const snap = r.job.snapshot();
    expect(snap.status).toBe('done');
    expect(target(snap, 's1').steps.map((s) => s.status)).toEqual(['ok', 'ok']);
    expect(t.calls.filter((c) => c.actionId === 'a1')).toHaveLength(2);
  });

  it('skip marks the step skipped and continues with the next one', async () => {
    const t = setup(
      (_s, a) => (a === 'a1' ? 1 : 0),
      recipe([{ actionId: 'a1' }, { actionId: 'a2' }]),
    );
    const r = await t.svc.create({ kind: 'replay', serverIds: ['s1'], recipeId: 'r1' });
    if (!r.ok) throw new Error();
    await settle();
    t.svc.decide(r.job.id, 's1', 'skip');
    await r.job.done;
    const snap = r.job.snapshot();
    expect(target(snap, 's1').steps.map((s) => s.status)).toEqual(['skipped', 'ok']);
    expect(snap.status).toBe('done');
  });

  it('abort leaves later steps pending and marks the target failed', async () => {
    const t = setup(
      (_s, a) => (a === 'a1' ? 1 : 0),
      recipe([{ actionId: 'a1' }, { actionId: 'a2' }, { actionId: 'a3' }]),
    );
    const r = await t.svc.create({ kind: 'replay', serverIds: ['s1'], recipeId: 'r1' });
    if (!r.ok) throw new Error();
    await settle();
    t.svc.decide(r.job.id, 's1', 'abort');
    await r.job.done;
    const s1 = target(r.job.snapshot(), 's1');
    expect(s1.status).toBe('failed');
    expect(s1.steps.map((s) => s.status)).toEqual(['failed', 'pending', 'pending']);
  });

  it('deciding for a target that is not paused is refused', async () => {
    const t = setup(() => 0, recipe([{ actionId: 'a1' }]));
    const r = await t.svc.create({ kind: 'replay', serverIds: ['s1'], recipeId: 'r1' });
    if (!r.ok) throw new Error();
    await r.job.done;
    expect(t.svc.decide(r.job.id, 's1', 'retry')).toBe(false);
    expect(t.svc.decide('nope', 's1', 'retry')).toBe(false);
  });

  it('cancel stops a running step (Ctrl-C), abandons a paused target and never starts later steps', async () => {
    const t = setup(
      (s) => (s === 's1' ? 'hang' : 1),
      recipe([{ actionId: 'a1' }, { actionId: 'a2' }]),
    );
    const r = await t.svc.create({ kind: 'replay', serverIds: ['s1', 's2'], recipeId: 'r1' });
    if (!r.ok) throw new Error();
    await settle();
    expect(target(r.job.snapshot(), 's1').status).toBe('running');
    expect(target(r.job.snapshot(), 's2').status).toBe('paused');
    expect(t.svc.cancel(r.job.id)).toBe(true);
    await r.job.done;
    const snap = r.job.snapshot();
    expect(snap.status).toBe('cancelled');
    expect(t.cancelled).toHaveLength(1);
    expect(t.calls.filter((c) => c.actionId === 'a2')).toHaveLength(0);
    expect(t.svc.cancel(r.job.id)).toBe(false); // already finished
  });

  it('is saved when finished, with no parameter values in it, and shows up in the list', async () => {
    const rec = recipe(
      [{ actionId: 'a1', params: { domain: '{{domain}}' } }],
      [{ name: 'domain', label: 'Domain' }],
    );
    const t = setup(() => 0, rec);
    const r = await t.svc.create({
      kind: 'replay',
      serverIds: ['s1'],
      recipeId: 'r1',
      values: { domain: 'secret-host.example' },
    });
    if (!r.ok) throw new Error();
    await r.job.done;
    await settle();
    expect(JSON.stringify(t.svc.list())).not.toContain('secret-host.example');
    expect(t.svc.list()[0]).toMatchObject({ name: 'Replay: My recipe', status: 'done' });
    expect(t.calls[0]!.params).toEqual({ domain: 'secret-host.example' }); // the runner gets the real value
  });
});

describe('JobService: planning and the Safety Net', () => {
  it('asks for missing required parameters instead of running', async () => {
    const t = setup(
      () => 0,
      recipe(
        [{ actionId: 'a1', params: { d: '{{domain}}' } }],
        [{ name: 'domain', label: 'Domain' }],
      ),
    );
    const plan = await t.svc.plan({ kind: 'replay', serverIds: ['s1'], recipeId: 'r1' });
    expect(plan).toMatchObject({ missing: ['domain'] });
    const r = await t.svc.create({ kind: 'replay', serverIds: ['s1'], recipeId: 'r1' });
    expect(r).toMatchObject({ ok: false, err: { error: 'missing_params', missing: ['domain'] } });
  });

  it('fills defaults, and the plan shows the commands per target with the highest risk', async () => {
    const t = setup(
      () => 0,
      recipe(
        [{ actionId: 'a1', params: { d: '{{domain}}' } }, { actionId: 'danger-x' }],
        [{ name: 'domain', label: 'D', default: 'x.com' }],
      ),
    );
    const plan = await t.svc.plan({ kind: 'replay', serverIds: ['s1', 's2'], recipeId: 'r1' });
    if ('error' in plan) throw new Error();
    expect(plan.risk).toBe('danger');
    expect(plan.targets).toHaveLength(2);
    expect(plan.targets[0]!.steps[0]).toMatchObject({ ok: true });
    expect(JSON.stringify(plan.targets[0]!.steps[0])).toContain('x.com');
  });

  it('refuses a caution/danger plan without confirmation (server-side), and accepts it with', async () => {
    const t = setup(() => 0, recipe([{ actionId: 'care-x' }]));
    const no = await t.svc.create({ kind: 'replay', serverIds: ['s1'], recipeId: 'r1' });
    expect(no).toMatchObject({
      ok: false,
      err: { error: 'confirmation_required', risk: 'caution' },
    });
    expect(t.calls).toHaveLength(0);
    const yes = await t.svc.create({
      kind: 'replay',
      serverIds: ['s1'],
      recipeId: 'r1',
      confirmed: true,
    });
    expect(yes.ok).toBe(true);
  });

  it('refuses when a target is not connected, naming it, and runs nothing', async () => {
    const t = setup(
      () => 0,
      recipe([{ actionId: 'a1' }]),
      (id) => id !== 's2',
    );
    const r = await t.svc.create({ kind: 'replay', serverIds: ['s1', 's2'], recipeId: 'r1' });
    expect(r).toMatchObject({ ok: false, err: { error: 'not_connected', serverIds: ['s2'] } });
    expect(t.calls).toHaveLength(0);
  });

  it('unknown recipe, and no steps', async () => {
    const t = setup(() => 0, recipe([{ actionId: 'a1' }]));
    expect(
      await t.svc.create({ kind: 'replay', serverIds: ['s1'], recipeId: 'nope' }),
    ).toMatchObject({ ok: false, err: { error: 'recipe_not_found' } });
    expect(await t.svc.create({ kind: 'broadcast', serverIds: ['s1'], steps: [] })).toMatchObject({
      ok: false,
      err: { error: 'no_steps' },
    });
  });
});

describe('JobService: broadcast', () => {
  it('runs one action on several servers', async () => {
    const t = setup(() => 0, recipe([]));
    const r = await t.svc.create({
      kind: 'broadcast',
      serverIds: ['s1', 's2', 's3'],
      steps: [{ actionId: 'a1', params: { x: 1 } }],
    });
    if (!r.ok) throw new Error();
    await r.job.done;
    expect(r.job.snapshot()).toMatchObject({ kind: 'broadcast', status: 'done' });
    expect(t.calls.map((c) => c.serverId).sort()).toEqual(['s1', 's2', 's3']);
    expect(r.job.name).toContain('Broadcast');
  });
});

describe('Job stream', () => {
  it('a late subscriber gets the output so far, then the current state, then live changes', async () => {
    const t = setup(() => 0, recipe([{ actionId: 'a1' }]));
    const r = await t.svc.create({ kind: 'replay', serverIds: ['s1'], recipeId: 'r1' });
    if (!r.ok) throw new Error();
    await r.job.done;
    const seen: string[] = [];
    r.job.subscribe((m) =>
      seen.push(m.type === 'output' ? `out:${m.text.trim()}` : `snap:${m.job.status}`),
    );
    expect(seen).toEqual(['out:out s1:a1 #1', 'snap:done']);
  });
});
