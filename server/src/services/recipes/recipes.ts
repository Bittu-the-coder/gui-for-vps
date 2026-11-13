import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { actionById, type Recipe, type RecipeDetail, type RecordingState } from '@gfv/shared';
import type { Db } from '../../db/index.js';
import { recipeSteps, recipes, recording } from '../../db/schema.js';

export type RecipeError = 'not_found' | 'already_recording' | 'not_recording' | 'bad_order';

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
        // Raw SQL on purpose: drizzle drops table qualifiers here, and `id` would bind to the inner table.
        stepCount: sql<number>`(select count(*) from recipe_steps rs where rs.recipe_id = recipes.id)`,
      })
      .from(recipes)
      .orderBy(sql`${recipes.updatedAt} desc`)
      .all();
    return rows;
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
    return { ...r, stepCount: steps.length, steps };
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
