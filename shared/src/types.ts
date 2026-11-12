import { z } from 'zod';

/** Response of GET /api/health. Shared so server and web agree on the shape. */
export const HealthSchema = z.object({
  ok: z.literal(true),
  name: z.literal('gfv'),
  version: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;
