import { z } from 'zod';
import { ACTIONS, previewAction, type ActionDef } from '../actions/index.js';
import { scrubSecrets } from './scrub.js';

/**
 * The assistant (M23). Three rules, enforced in code and tested:
 *  1. NOTHING is sent without a preview: `buildRequest` produces the exact text, the person sees it, only then is it sent;
 *  2. everything sent is scrubbed of secrets first;
 *  3. the assistant can only PROPOSE actions: each proposal is validated against the real action catalog and, if the
 *     person wants it, goes through the normal preview + confirmation of the Command Runner. It never runs anything.
 */

export const AI_KINDS = ['ask', 'explain'] as const;
export type AiKind = (typeof AI_KINDS)[number];

export const aiRequestSchema = z.object({
  kind: z.enum(AI_KINDS),
  /** The question, or the command / output to explain. */
  text: z.string().trim().min(1).max(8000),
  /** Optional context the person ticked: "what the active server is" is NEVER added unless chosen. */
  context: z
    .object({
      /** Recent command history (already stored redacted). */
      history: z.array(z.string().max(500)).max(20).optional(),
      /** The server's OS line, e.g. "Ubuntu 24.04". */
      os: z.string().max(100).optional(),
    })
    .optional(),
});
export type AiRequest = z.infer<typeof aiRequestSchema>;

const stripInternal = (a: ActionDef) => !a.quiet;

/** One line per action the assistant may propose: id, title, risk and parameter names. */
export function actionCatalog(): string {
  return ACTIONS.filter(stripInternal)
    .map((a) => {
      const shape = (a.params as { shape?: Record<string, unknown> }).shape;
      const params = shape ? Object.keys(shape).join(', ') : '';
      return `- ${a.id} [${a.risk}]: ${a.title}${params ? ` (params: ${params})` : ''}`;
    })
    .join('\n');
}

export const SYSTEM_PROMPT = [
  'You are the assistant inside GFV, a graphical tool for managing Linux servers over SSH. The person may be a beginner: explain plainly, briefly, and correctly. Never invent facts about their server.',
  'You cannot run anything. When an action from the catalog would help, you may PROPOSE it; the person reviews every command before it runs.',
  'Reply with a JSON object only, no markdown fences: {"answer": string, "actions": [{"actionId": string, "params": object, "why": string}]}. Use "actions": [] when nothing fits. Only use actionIds from this catalog, with the listed params:',
  actionCatalog(),
].join('\n\n');

export interface BuiltRequest {
  system: string;
  user: string;
  /** True when scrubbing removed something from what the person typed (the preview says so). */
  scrubbed: boolean;
}

export function buildRequest(req: AiRequest): BuiltRequest {
  const parts: string[] = [];
  parts.push(
    req.kind === 'explain'
      ? 'Explain this to me in plain words, and say if anything in it is risky:'
      : 'Question:',
  );
  parts.push(req.text);
  if (req.context?.os) parts.push(`The server runs: ${req.context.os}`);
  if (req.context?.history?.length)
    parts.push(`My most recent commands:\n${req.context.history.join('\n')}`);
  const raw = parts.join('\n\n');
  const user = scrubSecrets(raw);
  return { system: SYSTEM_PROMPT, user, scrubbed: user !== raw };
}

// ---- reading the answer back -----------------------------------------------------------------------------------------

export interface Proposal {
  actionId: string;
  title: string;
  params: unknown;
  why: string;
  risk: 'safe' | 'caution' | 'danger';
}

export interface AiAnswer {
  answer: string;
  proposals: Proposal[];
  /** Proposals dropped because the action does not exist or its parameters are invalid. */
  rejected: number;
}

const rawAnswer = z.object({
  answer: z.string().default(''),
  actions: z
    .array(
      z.object({
        actionId: z.string(),
        params: z.unknown().optional(),
        why: z.string().default(''),
      }),
    )
    .default([]),
});

/**
 * Parses the model's reply. It may wrap the JSON in text or fences; if it is not JSON at all the whole text is the
 * answer. Every proposed action is validated with the REAL `previewAction` (so a made-up action or bad parameters
 * are dropped) and the risk shown is the real one, not what the model claims.
 */
export function parseAnswer(text: string): AiAnswer {
  const json = extractJson(text);
  const parsed = json ? rawAnswer.safeParse(json) : undefined;
  if (!parsed?.success) return { answer: text.trim(), proposals: [], rejected: 0 };
  const proposals: Proposal[] = [];
  let rejected = 0;
  for (const a of parsed.data.actions.slice(0, 5)) {
    const action = ACTIONS.find((x) => x.id === a.actionId);
    if (!action || action.quiet) {
      rejected++;
      continue;
    }
    const p = previewAction(a.actionId, a.params ?? {});
    if (!p.ok) {
      rejected++;
      continue;
    }
    proposals.push({
      actionId: a.actionId,
      title: action.title,
      params: p.params,
      why: a.why.slice(0, 500),
      risk: p.preview.risk,
    });
  }
  return { answer: scrubSecrets(parsed.data.answer), proposals, rejected };
}

function extractJson(text: string): unknown {
  const t = text.trim();
  const tries = [t, t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')];
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end > start) tries.push(t.slice(start, end + 1));
  for (const s of tries) {
    try {
      const v = JSON.parse(s);
      if (v && typeof v === 'object') return v;
    } catch {
      /* try the next shape */
    }
  }
  return undefined;
}

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['anthropic', 'openai-compatible']),
  model: z.string().trim().min(1).max(100),
  /** OpenAI-compatible only: e.g. http://127.0.0.1:11434/v1 (Ollama). */
  baseUrl: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === '' || /^https?:\/\/[^\s]+$/.test(v), 'A http:// or https:// address')
    .default(''),
  /** Sent only when changing it; empty = keep the stored one. */
  apiKey: z.string().max(500).optional(),
});
export type AiSettingsInput = z.infer<typeof aiSettingsSchema>;

export interface AiSettingsPublic {
  enabled: boolean;
  provider: 'anthropic' | 'openai-compatible';
  model: string;
  baseUrl: string;
  hasKey: boolean;
  /** Where a send would go, for the preview ("api.anthropic.com", "127.0.0.1:11434"). */
  destination: string;
  /** Nothing leaves this computer (a local address). */
  local: boolean;
}

export function destinationOf(s: { provider: string; baseUrl: string }): {
  destination: string;
  local: boolean;
} {
  if (s.provider === 'anthropic') return { destination: 'api.anthropic.com', local: false };
  try {
    const u = new URL(s.baseUrl);
    const local = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname);
    return { destination: u.host, local };
  } catch {
    return { destination: s.baseUrl || 'not set', local: false };
  }
}
