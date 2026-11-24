import { z } from 'zod';

/** A logical map tile. Rendering and pixel conversion are presentation only. */
export const tilePointSchema = z.object({
  x: z.number().int().min(0).max(1023),
  y: z.number().int().min(0).max(1023),
});

export type TilePoint = z.infer<typeof tilePointSchema>;
