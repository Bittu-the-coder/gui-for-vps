import type { z } from 'zod';
import { detectDanger, type DangerMatch } from '../danger.js';
import { snapshotCommands, snapshotFileName } from '../snapshots.js';
import {
  defineAction,
  type ActionCtx,
  type ActionDef,
  type ParamField,
  type Risk,
} from './define.js';
import { devhubActions } from './devhub.js';
import { dockerActions } from './docker.js';
import { monitorActions } from './monitor.js';
import { serviceActions } from './services.js';
import { chmodPath, makeDir, renamePath, restoreSnapshot, writeRoot } from './files.js';
import { clearAptCache, connectionTest, deletePath, systemUptime } from './samples.js';

export { defineAction };
export type { ActionCtx, ActionDef, ParamField, Risk };

export const ACTIONS: ActionDef[] = [
  connectionTest,
  systemUptime,
  clearAptCache,
  deletePath,
  makeDir,
  renamePath,
  chmodPath,
  writeRoot,
  restoreSnapshot,
  ...monitorActions,
  ...serviceActions,
  ...dockerActions,
  ...devhubActions,
];

export const actionById = (id: string): ActionDef | undefined => ACTIONS.find((a) => a.id === id);

/** What the browser needs to list actions (no functions). */
export interface ActionInfo {
  id: string;
  title: string;
  explain: string;
  risk: Risk;
  riskReason?: string;
  fields: ParamField[];
}

export const listActions = (): ActionInfo[] =>
  ACTIONS.filter((a) => !a.internal).map((a) => ({
    id: a.id,
    title: a.title,
    explain: a.explain,
    risk: a.risk,
    ...(a.riskReason ? { riskReason: a.riskReason } : {}),
    fields: a.fields ?? [],
  }));

export interface Preview {
  actionId: string;
  title: string;
  explain: string;
  commands: string[];
  risk: Risk;
  /** Why it is risky: the action's own reason plus anything the detector found. */
  reasons: string[];
  matches: DangerMatch[];
  /** Minutes-long run: the dialog offers Hide and Cancel. */
  longRunning: boolean;
  /** Files that get a backup first (their backup commands are already in `commands`). */
  snapshots: { path: string; name: string }[];
}

export type PreviewResult =
  | { ok: true; preview: Preview; params: unknown }
  | { ok: false; error: 'unknown_action' }
  | {
      ok: false;
      error: 'invalid_params';
      issues: { path: (string | number)[]; message: string }[];
    };

const RANK: Record<Risk, number> = { safe: 0, caution: 1, danger: 2 };

/** Pure: validate params, build the commands, work out the final risk. Runs nothing. */
/** Used when we can't ask the server (preview before connecting) and in tests. */
export const DEFAULT_CTX: ActionCtx = { sudo: 'sudo -n ' };

export function previewAction(
  actionId: string,
  rawParams: unknown,
  ctx: ActionCtx = DEFAULT_CTX,
): PreviewResult {
  const action = actionById(actionId);
  if (!action) return { ok: false, error: 'unknown_action' };
  const parsed = (action.params as z.ZodTypeAny).safeParse(rawParams ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_params',
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    };
  }
  const snapPaths = action.snapshotPaths?.(parsed.data) ?? [];
  const runId = ctx.runId ?? 'preview';
  const commands = [
    ...snapPaths.flatMap((p) => snapshotCommands(p, runId, ctx.sudo)),
    ...action.commands(parsed.data, ctx),
  ];
  // The detector may RAISE the declared risk, never lower it.
  const matches = commands.flatMap((c) => detectDanger(c));
  const seen = new Set<string>();
  const unique = matches.filter((m) => !seen.has(m.id) && seen.add(m.id));
  let risk: Risk = action.risk;
  for (const m of unique) if (RANK[m.level] > RANK[risk]) risk = m.level;
  const dyn = action.dynamicRisk?.(parsed.data);
  if (dyn && RANK[dyn.risk] > RANK[risk]) risk = dyn.risk;
  const reasons = [
    ...(dyn ? [dyn.reason] : []),
    ...(action.riskReason && action.risk !== 'safe' ? [action.riskReason] : []),
    ...unique.map((m) => m.reason),
  ];
  return {
    ok: true,
    params: parsed.data,
    preview: {
      actionId,
      title: action.title,
      explain: action.explain,
      commands,
      risk,
      reasons,
      matches: unique,
      longRunning: !!action.longRunning,
      snapshots: snapPaths.map((path) => ({ path, name: snapshotFileName(runId, path) })),
    },
  };
}

/** Replace secret param values (quoted or not) in text, for history. */
export function redactSecrets(action: ActionDef, params: unknown, text: string): string {
  let out = text;
  const p = params as Record<string, unknown>;
  for (const key of action.secretParams ?? []) {
    const v = p[key];
    if (typeof v === 'string' && v.length > 0) {
      out = out.split(v).join('***');
    }
  }
  return out;
}

export function redactParams(action: ActionDef, params: unknown): unknown {
  const secret = new Set(action.secretParams ?? []);
  if (!secret.size || typeof params !== 'object' || params === null) return params;
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, secret.has(k) ? '***' : v]));
}
