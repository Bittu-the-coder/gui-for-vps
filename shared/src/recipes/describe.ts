import { actionById } from '../actions/index.js';
import { recipeStepInfo, type StepInfo } from './export.js';
import { findPlaceholders, substitute, type RecipeParam } from './params.js';

export interface DescribedStep {
  actionId: string;
  title: string;
  explain: string;
  /** The commands as they would run (placeholders shown as {{name}}). */
  commands: string[];
  risk: 'safe' | 'caution' | 'danger';
  reasons: string[];
  /** Why the step is not usable (unknown action, invalid params). */
  problem?: string;
}

const sentinel = (name: string) => `__GFVPARAM_${name.toUpperCase()}__`;

/** What one step would run: placeholders are swapped for a stand-in so the action still validates, then shown again. */
export function describeStep(actionId: string, params: unknown): StepInfo | null {
  const names = findPlaceholders(params);
  const info = recipeStepInfo(
    actionId,
    substitute(params, Object.fromEntries(names.map((n) => [n, sentinel(n)]))),
  );
  if (!info) return null;
  const back = (s: string) =>
    s.replace(/__GFVPARAM_([A-Z][A-Z0-9_]*)__/g, (_m, n: string) => `{{${n.toLowerCase()}}}`);
  return { ...info, commands: info.commands.map(back) };
}

export function describeSteps(
  steps: { actionId: string; params?: unknown }[],
  _params: RecipeParam[],
): DescribedStep[] {
  void _params;
  return steps.map((s) => {
    const a = actionById(s.actionId);
    const info = describeStep(s.actionId, s.params ?? {});
    if (!a)
      return {
        actionId: s.actionId,
        title: s.actionId,
        explain: '',
        commands: [],
        risk: 'danger',
        reasons: [],
        problem: 'This action does not exist in this version of GFV.',
      };
    if (!info)
      return {
        actionId: s.actionId,
        title: a.title,
        explain: a.explain,
        commands: [],
        risk: a.risk,
        reasons: [],
        problem: 'The parameters are not valid for this action.',
      };
    return {
      actionId: s.actionId,
      title: info.title,
      explain: info.explain,
      commands: info.commands,
      risk: info.risk,
      reasons: info.reasons,
    };
  });
}
