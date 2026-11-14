import type { ActionCtx } from './actions/define.js';
import { shellQuote } from './shell.js';

/**
 * Lockout protection. A change that could cut our own SSH access (a firewall rule, a new sshd setting) is
 * wrapped like this, ENTIRELY ON THE SERVER, so it works even when GFV loses the connection:
 *
 *   1. save the current state into ~/.gfv/guard/<runId>/ (this folder is also the undo history);
 *   2. start a detached timer on the server that restores that state after `seconds`,
 *      unless the file <dir>/ok exists;
 *   3. run the change;
 *   4. GFV opens a brand-new SSH connection (the old one may keep working while new ones are blocked),
 *      and only if that succeeds does it create <dir>/ok, which cancels the automatic undo.
 *
 * Nothing is hidden: every one of these commands is in the preview (and in Learn Mode).
 */
export interface GuardDef {
  /** What this guards ("ufw", "sshd"): written next to the saved state so each app lists only its own undo points. */
  kind: string;
  /** How long the server waits for the confirmation before it undoes the change. */
  seconds: number;
  /** Shell snippet (runs as the SSH user; `$DIR` is the existing backup folder): copy the current state into $DIR. */
  save(ctx: ActionCtx): string;
  /** Shell snippet that puts $DIR back. It runs unattended, from the timer, so it must not ask anything. */
  restore(ctx: ActionCtx): string;
}

export const GUARD_ROOT = '.gfv/guard';

/** Folder names are run ids (UUIDs); undo accepts only this shape, never a path. */
export const GUARD_ID = /^[A-Za-z0-9-]{8,64}$/;

export const guardDir = (runId: string) => `"$HOME/${GUARD_ROOT}/${runId}"`;

/** The visible commands that go BEFORE the change. */
export function guardStartCommands(
  g: GuardDef,
  runId: string,
  title: string,
  ctx: ActionCtx,
): string[] {
  const dir = guardDir(runId);
  const script = ['#!/bin/sh', `DIR=${dir}`, g.restore(ctx), ''].join('\n');
  const waiter = `sleep ${g.seconds}; [ -e "$1/ok" ] || { sh "$1/revert.sh" > "$1/revert.log" 2>&1; touch "$1/reverted"; }`;
  return [
    `mkdir -p -m 700 "$HOME/.gfv" "$HOME/${GUARD_ROOT}" ${dir}`,
    `DIR=${dir}; ${g.save(ctx)} && printf '%s\\n%s\\n%s\\n' ${shellQuote(title)} "$(date +%s)" ${shellQuote(g.kind)} > "$DIR/meta"`,
    `DIR=${dir}; printf '%s' ${shellQuote(script)} > "$DIR/revert.sh" && (nohup setsid sh -c ${shellQuote(waiter)} sh "$DIR" >/dev/null 2>&1 &) && echo ${shellQuote(`Safety timer set: if GFV cannot reach this server again within ${g.seconds} seconds, the previous state is restored automatically.`)}`,
  ];
}

/** The visible command that goes AFTER the change, once GFV proved it can still connect. */
export function guardConfirmCommand(runId: string): string {
  return `touch ${guardDir(runId)}/ok && echo "Confirmed: GFV can still reach this server, so the automatic undo was cancelled."`;
}
