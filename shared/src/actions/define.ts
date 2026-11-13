import type { z } from 'zod';

export type Risk = 'safe' | 'caution' | 'danger';

/** Facts about the target server that change how a command is written. */
export interface ActionCtx {
  /** "" when connected as root, "sudo -n " otherwise (-n: never hang on a password prompt). */
  sudo: string;
  /** The run this preview belongs to; names its snapshot files. Previews show "preview". */
  runId?: string;
  /** The SSH user's home directory (known once connected). */
  home?: string;
}

/** A text field the (temporary) Actions app renders for a param. */
export interface ParamField {
  name: string;
  label: string;
  placeholder?: string;
}

/**
 * One thing GFV can do on a server. Every GUI action that touches a server is an Action,
 * so Learn Mode, the Safety Net, history and Recipes can all work from the same description.
 */
export interface ActionDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Stable id like "system.uptime". Recipes and history refer to it. */
  id: string;
  title: string;
  /** Plain-English explanation (Learn Mode). */
  explain: string;
  /** Validated before `commands` ever sees it. */
  params: S;
  /**
   * The real shell commands. Params MUST go through shellQuote(); never concatenate raw values.
   * (Method syntax on purpose: it lets ActionDef<specific> be stored as ActionDef<ZodTypeAny>.)
   */
  commands(params: z.infer<S>, ctx: ActionCtx): string[];
  /** Declared risk. The detector can raise it, never lower it. */
  risk: Risk;
  riskReason?: string;
  /**
   * Files this action will overwrite. The preview gets backup commands for them FIRST (visible in
   * Learn Mode): a copy goes to ~/.gfv/snapshots/ on the server, and the run aborts if the backup fails.
   */
  snapshotPaths?(params: z.infer<S>): string[];
  /**
   * Commands for an exported recipe script when they should differ from `commands` (usually to be
   * safe to run twice). The script defines $SUDO, and ctx.sudo is "$SUDO ".
   */
  exportCommands?(params: z.infer<S>, ctx: ActionCtx): string[];
  /** Becomes a step when a recipe is being recorded. */
  recordable: boolean;
  /** Param names that hold secrets: redacted from history. */
  secretParams?: string[];
  /**
   * Read-only polling query (metrics, lists, logs). Runs through POST /api/runs/query: no
   * dialog, not saved to history. Must be `safe`.
   */
  quiet?: boolean;
  /** Risk that depends on the params (e.g. killing sshd). Can only raise the declared risk. */
  dynamicRisk?(params: z.infer<S>): { risk: Risk; reason: string } | undefined;
  /**
   * Takes minutes (package installs). Runs in a PTY so Cancel (Ctrl-C) stops the whole process
   * group, gets a 30-minute timeout, and the run dialog offers Hide and Cancel.
   */
  longRunning?: boolean;
  /** Driven by a real app's UI (e.g. the File Manager): hidden from the temporary Actions app. */
  internal?: boolean;
  /** Simple inputs for the temporary Actions app. */
  fields?: ParamField[];
}

export function defineAction<S extends z.ZodTypeAny>(def: ActionDef<S>): ActionDef<S> {
  if (def.quiet && def.risk !== 'safe') throw new Error(`${def.id}: quiet actions must be safe`);
  return def;
}
