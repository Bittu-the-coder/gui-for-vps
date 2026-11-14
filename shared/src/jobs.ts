import { z } from 'zod';
import { PreviewSchema, RiskSchema } from './runner.js';

/**
 * Jobs: the same steps run on one or several servers. A "replay" runs a recipe's steps; a "broadcast" runs
 * one action. Each target server runs its steps IN ORDER; targets run in PARALLEL. When a step fails, that
 * target PAUSES and waits for you (retry / skip the step / abort); the other targets carry on.
 */

export const JobStepInputSchema = z.object({
  actionId: z.string().min(1),
  params: z.unknown().optional(),
});
export type JobStepInput = z.infer<typeof JobStepInputSchema>;

const ValuesSchema = z.record(z.string(), z.string());

/** Either a recipe (`recipeId`) or loose steps (a broadcast). */
const JobSourceShape = {
  kind: z.enum(['replay', 'broadcast']),
  serverIds: z.array(z.string().min(1)).min(1).max(20),
  recipeId: z.string().optional(),
  steps: z.array(JobStepInputSchema).min(1).max(200).optional(),
  /** Values for the recipe's parameters ({{name}}). Never stored. */
  values: ValuesSchema.optional(),
};

export const JobPlanBodySchema = z.object(JobSourceShape);
export type JobPlanBody = z.infer<typeof JobPlanBodySchema>;

export const JobCreateBodySchema = z.object({
  ...JobSourceShape,
  name: z.string().trim().min(1).max(100).optional(),
  /** The user saw the plan and accepted its risk. Required (by the SERVER) if any step is caution/danger. */
  confirmed: z.boolean().optional(),
});
export type JobCreateBody = z.infer<typeof JobCreateBodySchema>;

export const JobDecisionBodySchema = z.object({ decision: z.enum(['retry', 'skip', 'abort']) });
export type JobDecision = z.infer<typeof JobDecisionBodySchema>['decision'];

// --- Plan (what WOULD run) ----------------------------------------------------------------------

export const PlanStepSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), preview: PreviewSchema }),
  z.object({ ok: z.literal(false), actionId: z.string(), error: z.string() }),
]);
export const PlanSchema = z.object({
  name: z.string(),
  /** Parameters that still need a value. */
  missing: z.array(z.string()),
  risk: RiskSchema,
  targets: z.array(
    z.object({
      serverId: z.string(),
      connected: z.boolean(),
      steps: z.array(PlanStepSchema),
    }),
  ),
});
export type Plan = z.infer<typeof PlanSchema>;

// --- Live state ----------------------------------------------------------------------------------

export type StepStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped';
export type TargetStatus = 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
export type JobStatus = 'running' | 'done' | 'failed' | 'cancelled';

export const StepStateSchema = z.object({
  actionId: z.string(),
  title: z.string(),
  status: z.enum(['pending', 'running', 'ok', 'failed', 'skipped']),
  exitCode: z.number().nullable().optional(),
  /** Why it failed when there was no exit code (not connected, connection lost...). */
  error: z.string().optional(),
});
export const TargetStateSchema = z.object({
  serverId: z.string(),
  status: z.enum(['pending', 'running', 'paused', 'done', 'failed', 'cancelled']),
  steps: z.array(StepStateSchema),
  /** Index of the step that is running or waiting for a decision. */
  current: z.number().int(),
});
export const JobSnapshotSchema = z.object({
  id: z.string(),
  kind: z.enum(['replay', 'broadcast']),
  name: z.string(),
  status: z.enum(['running', 'done', 'failed', 'cancelled']),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  targets: z.array(TargetStateSchema),
});
export type JobSnapshot = z.infer<typeof JobSnapshotSchema>;
export type TargetState = z.infer<typeof TargetStateSchema>;
export type StepState = z.infer<typeof StepStateSchema>;

/** Job stream (WebSocket /api/jobs/:id/stream): the full state after every change, plus output lines. */
export const JobMsgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), job: JobSnapshotSchema }),
  z.object({
    type: z.literal('output'),
    serverId: z.string(),
    step: z.number().int(),
    stream: z.enum(['stdout', 'stderr']),
    text: z.string(),
  }),
]);
export type JobMsg = z.infer<typeof JobMsgSchema>;

/** Overall risk of a set of steps: the highest one. */
export function maxRisk(
  risks: Array<'safe' | 'caution' | 'danger'>,
): 'safe' | 'caution' | 'danger' {
  return risks.includes('danger') ? 'danger' : risks.includes('caution') ? 'caution' : 'safe';
}

/** Job status from its targets: running while any is not finished. */
export function jobStatus(targets: Pick<TargetState, 'status'>[]): JobStatus {
  if (
    targets.some((t) => t.status === 'pending' || t.status === 'running' || t.status === 'paused')
  )
    return 'running';
  if (targets.some((t) => t.status === 'failed')) return 'failed';
  if (targets.some((t) => t.status === 'cancelled')) return 'cancelled';
  return 'done';
}
