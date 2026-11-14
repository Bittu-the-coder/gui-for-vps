import { z } from 'zod';
import { actionById } from '../actions/index.js';
import { maxRisk } from '../jobs.js';
import { RecipeParamSchema, paramProblems } from './params.js';
import { describeSteps, type DescribedStep } from './describe.js';

/**
 * A recipe as a file you can send to someone, post in a repository, or import. Versioned (`format`), human-readable
 * JSON, and containing NO secrets: secret parameters are only declared, never given a value.
 *
 * A file from somewhere else is UNTRUSTED input. `inspectRecipeFile` validates it from scratch (known actions,
 * valid params) and the server repeats it on import: nothing the browser says about a file is believed.
 */
export const RECIPE_FILE_FORMAT = 1;

export const RecipeFileSchema = z.object({
  format: z.literal(RECIPE_FILE_FORMAT),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  author: z.string().max(80).optional(),
  params: z.array(RecipeParamSchema).max(30).default([]),
  steps: z
    .array(z.object({ actionId: z.string().min(1).max(100), params: z.unknown() }))
    .min(1)
    .max(200),
});
export type RecipeFile = z.infer<typeof RecipeFileSchema>;

export type Inspection =
  | {
      ok: true;
      file: RecipeFile;
      steps: DescribedStep[];
      risk: 'safe' | 'caution' | 'danger';
    }
  | { ok: false; problems: string[] };

/** Validate a file (parsed JSON, or a JSON string) and describe every step exactly as it would run. */
export function inspectRecipeFile(input: unknown): Inspection {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, problems: ['That is not valid JSON.'] };
    }
  }
  const parsed = RecipeFileSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join('.') || 'file'}: ${i.message}`),
    };
  }
  const file = parsed.data;
  const problems = [
    ...paramProblems(
      file.params,
      file.steps.map((s) => s.params),
    ),
  ];
  const steps = describeSteps(file.steps, file.params);
  steps.forEach((s, i) => {
    if (s.problem) problems.push(`Step ${i + 1}: ${s.problem}`);
    const a = actionById(s.actionId);
    // A file may only use what a recording could have produced: actions that are recordable and hold no secrets.
    if (a && (!a.recordable || a.secretParams?.length))
      problems.push(`Step ${i + 1}: "${a.title}" cannot be part of a shared recipe.`);
  });
  if (problems.length) return { ok: false, problems };
  return { ok: true, file, steps, risk: maxRisk(steps.map((s) => s.risk)) };
}

/** The shareable file for a recipe. */
export function toRecipeFile(
  recipe: {
    name: string;
    params: RecipeFile['params'];
    steps: { actionId: string; params?: unknown }[];
  },
  meta: { description?: string; tags?: string[]; author?: string } = {},
): RecipeFile {
  return {
    format: RECIPE_FILE_FORMAT,
    name: recipe.name,
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.tags?.length ? { tags: meta.tags } : {}),
    ...(meta.author ? { author: meta.author } : {}),
    params: recipe.params,
    steps: recipe.steps.map((s) => ({ actionId: s.actionId, params: s.params ?? {} })),
  };
}
