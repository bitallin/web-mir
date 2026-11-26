import { z } from 'zod';

/**
 * Subset of the Tiled JSON map format used by Web Legend. Maps are authored as
 * orthogonal logical grids; pseudo-isometric projection is a client concern.
 * Unknown fields are allowed because Tiled adds metadata of its own.
 */
const tiledPropertySchema = z.object({
  name: z.string(),
  type: z.string(),
  value: z.unknown(),
});

const tiledObjectSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().default(''),
  type: z.string().default(''),
  x: z.number(),
  y: z.number(),
  width: z.number().default(0),
  height: z.number().default(0),
  point: z.boolean().optional(),
  properties: z.array(tiledPropertySchema).optional(),
});

const tileLayerSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string(),
  type: z.literal('tilelayer'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  data: z.array(z.number().int().min(0)).max(65_536),
  visible: z.boolean().default(true),
});

const objectLayerSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string(),
  type: z.literal('objectgroup'),
  objects: z.array(tiledObjectSchema).max(1_024),
  visible: z.boolean().default(true),
});

const tilesetSchema = z.object({
  firstgid: z.number().int().positive(),
  name: z.string(),
  image: z.string().optional(),
  tilewidth: z.number().int().positive(),
  tileheight: z.number().int().positive(),
  tilecount: z.number().int().positive(),
  columns: z.number().int().positive(),
});

export const tiledMapSchema = z.object({
  type: z.literal('map'),
  orientation: z.literal('orthogonal'),
  renderorder: z.string(),
  width: z.number().int().positive().max(256),
  height: z.number().int().positive().max(256),
  tilewidth: z.number().int().positive(),
  tileheight: z.number().int().positive(),
  infinite: z.literal(false),
  layers: z.array(z.union([tileLayerSchema, objectLayerSchema])),
  tilesets: z.array(tilesetSchema).min(1),
  properties: z.array(tiledPropertySchema).optional(),
});

export type TiledMap = z.infer<typeof tiledMapSchema>;
export type TiledObject = z.infer<typeof tiledObjectSchema>;
export type TiledTileLayer = z.infer<typeof tileLayerSchema>;
export type TiledObjectLayer = z.infer<typeof objectLayerSchema>;

export function tiledPropertyValue(
  object: { properties?: { name: string; value: unknown }[] | undefined },
  name: string,
): unknown {
  return object.properties?.find((property) => property.name === name)?.value;
}

export function tiledStringProperty(object: TiledObject, name: string): string | undefined {
  const value = tiledPropertyValue(object, name);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function tiledIntegerProperty(object: TiledObject, name: string): number | undefined {
  const value = tiledPropertyValue(object, name);
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

export function tiledBooleanProperty(object: TiledObject, name: string): boolean | undefined {
  const value = tiledPropertyValue(object, name);
  return typeof value === 'boolean' ? value : undefined;
}
