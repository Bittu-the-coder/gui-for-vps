import { z } from 'zod';

/** Request bodies, stream messages and history rows for the Command Runner. */

export const RiskSchema = z.enum(['safe', 'caution', 'danger']);

export const PreviewBodySchema = z.object({
  serverId: z.string().min(1),
  actionId: z.string().min(1),
  params: z.unknown().optional(),
});
export type PreviewBody = z.infer<typeof PreviewBodySchema>;

export const RunBodySchema = PreviewBodySchema.extend({
  /** The user saw the preview and accepted the risk. Required by the SERVER for caution/danger. */
  confirmed: z.boolean().optional(),
});
export type RunBody = z.infer<typeof RunBodySchema>;

export const PreviewSchema = z.object({
  actionId: z.string(),
  title: z.string(),
  explain: z.string(),
  commands: z.array(z.string()),
  risk: RiskSchema,
  reasons: z.array(z.string()),
  matches: z.array(
    z.object({
      id: z.string(),
      level: z.enum(['caution', 'danger']),
      reason: z.string(),
      safer: z.string().optional(),
    }),
  ),
});

export const RunStartedSchema = z.object({ runId: z.string() });

/**
 * Run stream (WebSocket /api/runs/:id/stream), all TEXT JSON frames, server -> browser.
 * The server replays everything so far when you connect, so late joiners miss nothing.
 */
export const RunMsgSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('step'),
    index: z.number().int(),
    total: z.number().int(),
    command: z.string(),
  }),
  z.object({ type: z.literal('output'), stream: z.enum(['stdout', 'stderr']), text: z.string() }),
  z.object({ type: z.literal('truncated') }),
  /** exitCode null = the connection dropped. failedStep = index of the command that failed. */
  z.object({
    type: z.literal('done'),
    exitCode: z.number().nullable(),
    failedStep: z.number().int().optional(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type RunMsg = z.infer<typeof RunMsgSchema>;

export const HistoryEntrySchema = z.object({
  id: z.string(),
  serverId: z.string(),
  actionId: z.string(),
  title: z.string(),
  explain: z.string().nullable(),
  params: z.unknown(),
  commands: z.array(z.string()),
  risk: RiskSchema,
  exitCode: z.number().nullable(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  outputTail: z.string(),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const HistoryResponseSchema = z.object({
  entries: z.array(HistoryEntrySchema),
  /** Distinct command names GFV has run so far ("You've learned N commands"). */
  learned: z.array(z.string()),
});
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;
