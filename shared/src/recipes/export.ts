import { actionById, previewAction, type Risk } from '../actions/index.js';
import { shellQuote } from '../shell.js';
import { findPlaceholders, substitute, type RecipeParam } from './params.js';

/** In an exported script the sudo prefix is a variable, so the script works as root or as a sudo user. */
const SCRIPT_CTX = { sudo: '$SUDO ', runId: 'recipe' } as const;

export interface StepInfo {
  title: string;
  explain: string;
  commands: string[];
  risk: Risk;
  reasons: string[];
}

/** What one recorded step would run in a script (null if the action no longer exists or its params are invalid). */
export function recipeStepInfo(actionId: string, params: unknown): StepInfo | null {
  const action = actionById(actionId);
  const p = previewAction(actionId, params, SCRIPT_CTX);
  if (!action || !p.ok) return null;
  // exportCommands (when present) replace the normal commands; the snapshot steps never belong in a script.
  const commands = action.exportCommands
    ? action.exportCommands(p.params, SCRIPT_CTX)
    : action.commands(p.params, SCRIPT_CTX);
  return {
    title: p.preview.title,
    explain: p.preview.explain,
    commands,
    risk: p.preview.risk,
    reasons: p.preview.reasons,
  };
}

const wrap = (text: string, width = 90): string[] => {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    if (cur && cur.length + w.length + 1 > width) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
};
const comment = (text: string) => wrap(text).map((l) => `# ${l}`);

/** A parameter becomes this environment variable in an exported script (the prefix avoids clashes with HOME, PATH...). */
export const paramVar = (name: string) => `GFV_${name.toUpperCase()}`;

const SENTINEL = (name: string) => `__GFVPARAM_${name.toUpperCase()}__`;
const SENTINEL_AT = /__GFVPARAM_([A-Z][A-Z0-9_]*)__/y;
/** `"${GFV_NAME}"`: a double-quoted variable, so the value is one word and is never parsed as syntax. */
const varRef = (name: string) => '"$' + '{' + 'GFV_' + name + '}"';

/**
 * Turn placeholders into shell variable references. Steps are built with a sentinel in place of `{{name}}`
 * (so the action's own validation still passes); here the sentinel becomes `"${GFV_NAME}"`. shellQuote may
 * have put it inside single quotes: then we close the quote, insert the reference, and reopen.
 */
export function injectVars(command: string): string {
  let out = '';
  let inSingle = false;
  for (let i = 0; i < command.length; i++) {
    SENTINEL_AT.lastIndex = i;
    const m = SENTINEL_AT.exec(command);
    if (m) {
      out += inSingle ? "'" + varRef(m[1]!) + "'" : varRef(m[1]!);
      i += m[0].length - 1;
      continue;
    }
    const c = command[i]!;
    if (!inSingle && c === '\\') {
      out += c + (command[i + 1] ?? ''); // an escaped character outside quotes (shellQuote's  \' )
      i++;
      continue;
    }
    if (c === "'") inSingle = !inSingle;
    out += c;
  }
  return out;
}

export interface ExportInput {
  name: string;
  steps: { actionId: string; params?: unknown }[];
  /** Shown in the header (the machine the recipe was recorded on). */
  recordedOn?: string;
  generatedAt: Date;
  /** Declared parameters: each becomes a GFV_<NAME> environment variable that the script reads. */
  params?: RecipeParam[];
}

/** Turns a recipe into a bash script. Pure, so it is easy to test. */
export function exportRecipe(input: ExportInput): string {
  const declared = input.params ?? [];
  const used = new Set<string>();
  input.steps.forEach((s) => findPlaceholders(s.params, used));
  const sentinels = Object.fromEntries([...used].map((n) => [n, SENTINEL(n)]));
  const infos = input.steps.map((s) => {
    const info = recipeStepInfo(s.actionId, substitute(s.params, sentinels));
    return { ...s, info: info && { ...info, commands: info.commands.map(injectVars) } };
  });
  const usesSudo = infos.some((s) => s.info?.commands.some((c) => c.includes('$SUDO')));
  const total = infos.length;

  const out: string[] = [
    '#!/usr/bin/env bash',
    `# Recipe: ${input.name.replace(/[\r\n]+/g, ' ')}`,
    `# Exported from GFV on ${input.generatedAt.toISOString().slice(0, 10)}${input.recordedOn ? `, recorded on ${input.recordedOn.replace(/[\r\n]+/g, ' ')}` : ''}.`,
    ...comment(
      'Every step was recorded from a successful GFV action, and is written to be safe to run again where possible. File edits and uploads are not part of a recipe.',
    ),
    'set -euo pipefail',
    '',
  ];
  if (usesSudo) {
    out.push(
      '# Run this as root, or as a user that can use sudo.',
      'SUDO=""',
      'if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi',
      '',
    );
  }

  // Parameters: environment variables, so one script serves different domains and passwords.
  const names = [...new Set([...declared.map((p) => p.name), ...used])];
  if (names.length) {
    out.push(
      '# Parameters: set them as environment variables, for example:  GFV_DOMAIN=example.com bash recipe.sh',
    );
    for (const n of names) {
      const p = declared.find((x) => x.name === n);
      const v = paramVar(n);
      const label = (p?.label ?? n).replace(/[\r\n]+/g, ' ');
      const unset = '[ -z "$' + '{' + v + ':-}" ]';
      if (p && !p.secret && p.default !== undefined) {
        out.push('if ' + unset + '; then ' + v + '=' + shellQuote(p.default) + '; fi  # ' + label);
      } else {
        out.push(
          'if ' + unset + '; then echo ' + shellQuote(`Set ${v} (${label})`) + ' >&2; exit 1; fi',
        );
      }
    }
    out.push('');
  }

  infos.forEach(({ actionId, info }, i) => {
    out.push(`echo ${shellQuote(`==> Step ${i + 1}/${total}: ${info?.title ?? actionId}`)}`);
    if (!info) {
      out.push(
        `# Skipped: "${actionId.replace(/[\r\n]+/g, ' ')}" is not available in this version of GFV.`,
        '',
      );
      return;
    }
    out.push(...comment(info.explain));
    if (info.risk !== 'safe') {
      for (const r of info.reasons)
        out.push(...comment(`${info.risk === 'danger' ? '⚠ DANGER' : '⚠ Caution'}: ${r}`));
    }
    out.push(...info.commands, '');
  });

  if (total === 0) out.push('# (This recipe has no steps.)', '');
  out.push('echo "==> Done."', '');
  return out.join('\n');
}
