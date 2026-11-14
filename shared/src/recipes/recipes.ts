import { z } from 'zod';
import { RecipeParamSchema } from './params.js';

/** Recipes: recorded sequences of successful, recordable actions. */

export const RecipeSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The server the recording was made on. */
  serverId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  stepCount: z.number().int(),
  /** Values asked for when the recipe is replayed or exported. */
  params: z.array(RecipeParamSchema),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const RecipeStepSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  actionId: z.string(),
  params: z.unknown(),
  createdAt: z.number(),
});
export type RecipeStep = z.infer<typeof RecipeStepSchema>;

export const RecipeDetailSchema = RecipeSchema.extend({ steps: z.array(RecipeStepSchema) });
export type RecipeDetail = z.infer<typeof RecipeDetailSchema>;

export const RecordingStateSchema = z.object({
  active: z
    .object({
      recipeId: z.string(),
      serverId: z.string(),
      name: z.string(),
      stepCount: z.number().int(),
    })
    .nullable(),
});
export type RecordingState = z.infer<typeof RecordingStateSchema>;

export const StartRecordingBodySchema = z.object({
  serverId: z.string().min(1),
  name: z.string().trim().min(1).max(100).optional(),
});
export const RenameRecipeBodySchema = z.object({ name: z.string().trim().min(1).max(100) });
export const SetRecipeParamsBodySchema = z.object({ params: z.array(RecipeParamSchema).max(30) });
export const UpdateStepBodySchema = z.object({ params: z.unknown() });
export const ReorderStepsBodySchema = z.object({ order: z.array(z.string()).max(1000) });
