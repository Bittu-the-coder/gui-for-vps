import type { z } from 'zod';

export type Risk = 'safe' | 'caution' | 'danger';

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
  commands(params: z.infer<S>): string[];
  /** Declared risk. The detector can raise it, never lower it. */
  risk: Risk;
  riskReason?: string;
  /** Files to back up before running (the snapshot service arrives in M5/M8). */
  snapshotPaths?: string[];
  /** Becomes a step when a recipe is being recorded. */
  recordable: boolean;
  /** Param names that hold secrets: redacted from history. */
  secretParams?: string[];
  /** Simple inputs for the temporary Actions app. */
  fields?: ParamField[];
}

export function defineAction<S extends z.ZodTypeAny>(def: ActionDef<S>): ActionDef<S> {
  return def;
}
