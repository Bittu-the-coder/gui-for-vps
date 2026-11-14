import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import {
  actionById,
  paramProblems,
  substitute,
  type Recipe,
  type RecipeDetail,
  type RecipeParam,
  type RecordingState,
} from '@gfv/shared';
import type { Db } from '../../db/index.js';
import { recipeSteps, recipes, recording } from '../../db/schema.js';

export type RecipeError =
  | 'not_found'
  | 'already_recording'
  | 'not_recording'
  | 'bad_order'
  | { error: 'invalid'; problems: string[] };

/** Recipes and the recorder. Steps are (actionId, params): the script is regenerated on export. */
export class RecipeService {
  constructor(private db: Db) {}

  list(): Recipe[] {
    const rows = this.db
      .select({
        id: recipes.id,
        name: recipes.name,
        serverId: recipes.serverId,
        createdAt: recipes.createdAt,
        updatedAt: recipes.updatedAt,
        params: recipes.params,
        // Raw SQL on purpose: drizzle drops table qualifiers here, and `id` would bind to the inner table.
        stepCount: sql<number>`(select count(*) from recipe_steps rs where rs.recipe_id = recipes.id)`,
      })
      .from(recipes)
      .orderBy(sql`${recipes.updatedAt} desc`)
      .all();
    return rows.map((r) => ({ ...r, params: r.params as RecipeParam[] }));
  }

  get(id: string): RecipeDetail | undefined {
    const r = this.db.select().from(recipes).where(eq(recipes.id, id)).get();
    if (!r) return undefined;
    const steps = this.db
      .select()
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, id))
      .orderBy(asc(recipeSteps.position))
      .all()
      .map((s) => ({
        id: s.id,
        position: s.position,
        actionId: s.actionId,
        params: s.params,
        createdAt: s.createdAt,
      }));
    return { ...r, params: r.params as RecipeParam[], stepCount: steps.length, steps };
  }

  /**
   * Declare the parameters ({{name}} placeholders) of a recipe. Every placeholder used by a step must be
   * declared, and the steps must still be valid when filled with each parameter's default (or an example).
   */
  setParams(id: string, params: RecipeParam[]): RecipeError | null {
    const detail = this.get(id);
    if (!detail) return 'not_found';
    const problems = paramProblems(
      params,
      detail.steps.map((s) => s.params),
    );
    problems.push(...this.validateSteps(detail.steps, params));
    if (problems.length) return { error: 'invalid', problems };
    this.db.update(recipes).set({ params, updatedAt: Date.now() }).where(eq(recipes.id, id)).run();
    return null;
  }

  /** Change one step's params (to add {{placeholders}}, or fix a path). Validated like a real run. */
  updateStep(recipeId: string, stepId: string, params: unknown): RecipeError | null {
    const detail = this.get(recipeId);
    const step = detail?.steps.find((s) => s.id === stepId);
    if (!detail || !step) return 'not_found';
    const next = detail.steps.map((s) => (s.id === stepId ? { ...s, params } : s));
    const problems = [
      ...paramProblems(
        detail.params,
        next.map((s) => s.params),
      ),
      ...this.validateSteps(next, detail.params),
    ];
    if (problems.length) return { error: 'invalid', problems };
    this.db.update(recipeSteps).set({ params }).where(eq(recipeSteps.id, stepId)).run();
    this.db.update(recipes).set({ updatedAt: Date.now() }).where(eq(recipes.id, recipeId)).run();
    return null;
  }

  /** Each step must pass its action's schema once placeholders hold a stand-in (the default, else "example"). */
  private validateSteps(
    steps: { actionId: string; params?: unknown }[],
    params: RecipeParam[],
  ): string[] {
    const stand: Record<string, string> = {};
    for (const p of params) stand[p.name] = p.default ?? 'example';
    const problems: string[] = [];
    steps.forEach((s, i) => {
      const a = actionById(s.actionId);
      if (!a) return problems.push(`Step ${i + 1}: unknown action ${s.actionId}.`);
      const r = a.params.safeParse(substitute(s.params, stand));
      if (!r.success)
        problems.push(
          `Step ${i + 1} (${a.title}): ${r.error.issues.map((x) => x.message).join('; ')}`,
        );
    });
    return problems;
  }

  /** A recipe made in one go (an imported file, or a clone of a server). Steps are re-validated by the caller. */
  create(opts: {
    name: string;
    serverId: string | null;
    params: RecipeParam[];
    steps: { actionId: string; params?: unknown }[];
  }): string {
    const id = randomUUID();
    const now = Date.now();
    this.db.transaction((tx) => {
      tx.insert(recipes)
        .values({
          id,
          name: opts.name,
          serverId: opts.serverId,
          createdAt: now,
          updatedAt: now,
          params: opts.params,
        })
        .run();
      opts.steps.forEach((s, i) =>
        tx
          .insert(recipeSteps)
          .values({
            id: randomUUID(),
            recipeId: id,
            position: i,
            actionId: s.actionId,
            params: s.params ?? {},
            createdAt: now,
          })
          .run(),
      );
    });
    return id;
  }

  rename(id: string, name: string): boolean {
    const r = this.db
      .update(recipes)
      .set({ name, updatedAt: Date.now() })
      .where(eq(recipes.id, id))
      .run();
    return r.changes > 0;
  }

  remove(id: string): boolean {
    return this.db.delete(recipes).where(eq(recipes.id, id)).run().changes > 0;
  }

  deleteStep(recipeId: string, stepId: string): boolean {
    const r = this.db.delete(recipeSteps).where(eq(recipeSteps.id, stepId)).run();
    if (!r.changes) return false;
    this.renumber(recipeId);
    return true;
  }

  /** `order` must be exactly the recipe's step ids, in the new order. */
  reorder(recipeId: string, order: string[]): RecipeError | null {
    const detail = this.get(recipeId);
    if (!detail) return 'not_found';
    const have = new Set(detail.steps.map((s) => s.id));
    if (
      order.length !== have.size ||
      new Set(order).size !== order.length ||
      !order.every((id) => have.has(id))
    ) {
      return 'bad_order';
    }
    this.db.transaction((tx) => {
      order.forEach((id, i) =>
        tx.update(recipeSteps).set({ position: i }).where(eq(recipeSteps.id, id)).run(),
      );
      tx.update(recipes).set({ updatedAt: Date.now() }).where(eq(recipes.id, recipeId)).run();
    });
    return null;
  }

  private renumber(recipeId: string) {
    const steps = this.db
      .select({ id: recipeSteps.id })
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, recipeId))
      .orderBy(asc(recipeSteps.position))
      .all();
    this.db.transaction((tx) => {
      steps.forEach((s, i) =>
        tx.update(recipeSteps).set({ position: i }).where(eq(recipeSteps.id, s.id)).run(),
      );
      tx.update(recipes).set({ updatedAt: Date.now() }).where(eq(recipes.id, recipeId)).run();
    });
  }

  // ---- recording -----------------------------------------------------------------------

  state(): RecordingState {
    const rec = this.db.select().from(recording).where(eq(recording.id, 1)).get();
    if (!rec) return { active: null };
    const detail = this.get(rec.recipeId);
    if (!detail) return { active: null };
    return {
      active: {
        recipeId: rec.recipeId,
        serverId: rec.serverId,
        name: detail.name,
        stepCount: detail.stepCount,
      },
    };
  }

  start(serverId: string, name?: string): { recipeId: string } | RecipeError {
    if (this.state().active) return 'already_recording';
    const now = Date.now();
    const id = randomUUID();
    this.db.transaction((tx) => {
      tx.insert(recipes)
        .values({
          id,
          name: name ?? `Recipe ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}`,
          serverId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.insert(recording).values({ id: 1, recipeId: id, serverId }).run();
    });
    return { recipeId: id };
  }

  stop(): { recipeId: string } | RecipeError {
    const rec = this.db.select().from(recording).where(eq(recording.id, 1)).get();
    if (!rec) return 'not_recording';
    this.db.delete(recording).where(eq(recording.id, 1)).run();
    return { recipeId: rec.recipeId };
  }

  /** Runner hook: a run finished successfully. Recorded if a recording is active for that server. */
  recordRun = (e: { serverId: string; actionId: string; params: unknown }): void => {
    const rec = this.db.select().from(recording).where(eq(recording.id, 1)).get();
    if (!rec || rec.serverId !== e.serverId) return;
    const action = actionById(e.actionId);
    // Secrets can't be put in a script we hand out, so those actions are never recorded.
    if (!action?.recordable || action.secretParams?.length) return;
    const max = this.db
      .select({ m: sql<number>`coalesce(max(${recipeSteps.position}), -1)` })
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, rec.recipeId))
      .get();
    const now = Date.now();
    this.db
      .insert(recipeSteps)
      .values({
        id: randomUUID(),
        recipeId: rec.recipeId,
        position: (max?.m ?? -1) + 1,
        actionId: e.actionId,
        params: e.params,
        createdAt: now,
      })
      .run();
    this.db.update(recipes).set({ updatedAt: now }).where(eq(recipes.id, rec.recipeId)).run();
  };
}
