import { z } from 'zod';
import { DangerMatchSchema } from './danger.js';

/**
 * Terminal WebSocket protocol (/api/terminal/:serverId?cols=&rows=).
 *  - BINARY frames: raw terminal bytes (browser -> server = keystrokes, server -> browser = output).
 *  - TEXT frames: JSON control messages, defined below.
 */

export const TermClientMsgSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('resize'),
    cols: z.number().int().min(1).max(500),
    rows: z.number().int().min(1).max(300),
  }),
  /** Answer to a `danger` prompt: release the held Enter, or cancel the line. */
  z.object({ type: z.literal('danger_decision'), action: z.enum(['run', 'cancel']) }),
]);
export type TermClientMsg = z.infer<typeof TermClientMsgSchema>;

export const TermServerMsgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('exit'), code: z.number().nullable() }),
  z.object({
    type: z.literal('error'),
    code: z.enum(['not_connected', 'shell_failed']),
    message: z.string(),
  }),
  /** The Enter key is being held until the client sends `danger_decision`. */
  z.object({ type: z.literal('danger'), command: z.string(), matches: z.array(DangerMatchSchema) }),
]);
export type TermServerMsg = z.infer<typeof TermServerMsgSchema>;
