import { actionById, previewAction, type Risk } from '../actions/index.js';
import { shellQuote } from '../shell.js';

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

export interface ExportInput {
  name: string;
  steps: { actionId: string; params?: unknown }[];
  /** Shown in the header (the machine the recipe was recorded on). */
  recordedOn?: string;
  generatedAt: Date;
}

/** Turns a recipe into a bash script. Pure, so it is easy to test. */
export function exportRecipe(input: ExportInput): string {
  const infos = input.steps.map((s) => ({ ...s, info: recipeStepInfo(s.actionId, s.params) }));
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
