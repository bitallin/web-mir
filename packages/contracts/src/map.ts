import { z } from 'zod';

/**
 * Phase 1 technical map format. Real Tiled maps are compiled into a
 * MapRuntimeManifest by `map-runtime` in phase 3; this schema is the shared
 * client/server contract for the temporary test map until then.
 */
export const MAP_SCHEMA_VERSION = 1 as const;

export const MAP_TILE_FLOOR = '.' as const;
export const MAP_TILE_GRASS = ',' as const;
export const MAP_TILE_WALL = '#' as const;

export const tilePointSchema = z.object({
  x: z.number().int().min(0).max(1023),
  y: z.number().int().min(0).max(1023),
});

export type TilePoint = z.infer<typeof tilePointSchema>;

const mapTileChars = new Set<string>([MAP_TILE_FLOOR, MAP_TILE_GRASS, MAP_TILE_WALL]);

export const mapManifestSchema = z
  .object({
    schemaVersion: z.literal(MAP_SCHEMA_VERSION),
    id: z.string().regex(/^[a-z0-9_]+$/, 'must be a lowercase snake_case id'),
    name: z.string().min(1).max(64),
    width: z.number().int().min(1).max(256),
    height: z.number().int().min(1).max(256),
    tiles: z.array(z.string()),
    spawnPoints: z.array(tilePointSchema).min(1).max(64),
  })
  .strict()
  .superRefine((map, ctx) => {
    if (map.tiles.length !== map.height) {
      ctx.addIssue({
        code: 'custom',
        path: ['tiles'],
        message: `expected ${map.height} rows, received ${map.tiles.length}`,
      });
      return;
    }

    map.tiles.forEach((row, y) => {
      if (row.length !== map.width) {
        ctx.addIssue({
          code: 'custom',
          path: ['tiles', y],
          message: `expected ${map.width} columns, received ${row.length}`,
        });
        return;
      }
      for (const char of row) {
        if (!mapTileChars.has(char)) {
          ctx.addIssue({
            code: 'custom',
            path: ['tiles', y],
            message: `unknown tile character "${char}"`,
          });
          return;
        }
      }
    });

    map.spawnPoints.forEach((point, index) => {
      if (!isTileInsideMap(map, point.x, point.y)) {
        ctx.addIssue({
          code: 'custom',
          path: ['spawnPoints', index],
          message: 'spawn point is outside the map',
        });
        return;
      }
      if (!isTileWalkable(map, point.x, point.y)) {
        ctx.addIssue({
          code: 'custom',
          path: ['spawnPoints', index],
          message: 'spawn point must be on a walkable tile',
        });
      }
    });
  });

export type MapManifest = z.infer<typeof mapManifestSchema>;

export function isTileInsideMap(
  map: Pick<MapManifest, 'width' | 'height'>,
  x: number,
  y: number,
): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < map.width &&
    y < map.height
  );
}

export function tileCharAt(map: Pick<MapManifest, 'tiles'>, x: number, y: number): string {
  const row = map.tiles[y];
  if (row === undefined) {
    return MAP_TILE_WALL;
  }
  return row[x] ?? MAP_TILE_WALL;
}

export function isTileWalkable(
  map: Pick<MapManifest, 'width' | 'height' | 'tiles'>,
  x: number,
  y: number,
): boolean {
  if (!isTileInsideMap(map, x, y)) {
    return false;
  }
  return tileCharAt(map, x, y) !== MAP_TILE_WALL;
}
