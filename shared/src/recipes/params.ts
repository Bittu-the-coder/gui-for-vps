import { z } from 'zod';

/**
 * Recipe parameters. A step's params may contain `{{name}}` placeholders inside strings; the value is
 * filled in when the recipe is replayed (a domain name, a database password...).
 *
 * This is safe because substitution happens on the PARAMS, before the action validates them and before
 * `shellQuote` turns them into a command: a value can never become shell syntax.
 */
export const RecipeParamSchema = z.object({
  /** Lower-case identifier: used as {{name}} in steps and as an environment variable in exported scripts. */
  name: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, 'Use lower-case letters, digits and _'),
  label: z.string().trim().min(1).max(80),
  /** Used when no value is given. Parameters without a default are required. */
  default: z.string().max(500).optional(),
  /** Never stored, logged or kept in history (a password). Needs a value every time. */
  secret: z.boolean().optional(),
});
export type RecipeParam = z.infer<typeof RecipeParamSchema>;

export const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/** Every placeholder name used anywhere inside `value` (strings, nested objects and arrays). */
export function findPlaceholders(value: unknown, into = new Set<string>()): string[] {
  if (typeof value === 'string') {
    for (const m of value.matchAll(PLACEHOLDER)) into.add(m[1]!);
  } else if (Array.isArray(value)) {
    value.forEach((v) => findPlaceholders(v, into));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => findPlaceholders(v, into));
  }
  return [...into];
}

/** `value` with every placeholder replaced. Unknown names are left alone (and reported by `missing`). */
export function substitute<T>(value: T, values: Record<string, string>): T {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER, (whole, name: string) =>
      Object.hasOwn(values, name) ? values[name]! : whole,
    ) as T;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, values)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, substitute(v, values)]),
    ) as T;
  }
  return value;
}

export type ValuesResult =
  { ok: true; values: Record<string, string> } | { ok: false; missing: string[] };

/** Given values + defaults for every declared parameter. `missing` = required and not provided. */
export function resolveValues(params: RecipeParam[], given: Record<string, string>): ValuesResult {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const p of params) {
    const v = given[p.name];
    if (v !== undefined && v !== '') values[p.name] = v;
    else if (!p.secret && p.default !== undefined) values[p.name] = p.default;
    else missing.push(p.name);
  }
  return missing.length ? { ok: false, missing } : { ok: true, values };
}

/** Problems with a recipe's parameter set: placeholders nobody declared, and duplicate names. */
export function paramProblems(params: RecipeParam[], stepParams: unknown[]): string[] {
  const problems: string[] = [];
  const names = params.map((p) => p.name);
  for (const n of new Set(names.filter((n, i) => names.indexOf(n) !== i)))
    problems.push(`The parameter "${n}" is declared twice.`);
  const used = new Set<string>();
  stepParams.forEach((p) => findPlaceholders(p, used));
  for (const n of used)
    if (!names.includes(n)) problems.push(`A step uses {{${n}}} but there is no parameter "${n}".`);
  return problems;
}
