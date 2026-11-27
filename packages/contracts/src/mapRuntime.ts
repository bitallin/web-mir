import { z } from 'zod';

import { tilePointSchema } from './map';

/**
 * Compiled map format shared by the Control API (spawn selection), the game
 * server (authoritative navigation) and the browser (rendering). Source maps
 * are authored in Tiled and compiled by `@web-legend/map-runtime`; this schema
 * is the immutable runtime contract, not the editable source.
 */
export const MAP_RUNTIME_SCHEMA_VERSION = 2 as const;

export const STARTER_TOWN_MAP_ID = 'starter_town';
export const STARTER_WILDS_MAP_ID = 'starter_wilds';
export const RUINED_FIELDS_MAP_ID = 'ruined_fields';

export const mapIdSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z][a-z0-9_]*$/, 'map id must be lowercase snake_case');

const layerSchema = z.array(z.number().int().min(0).max(65_535)).max(65_536);

const tilesetSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[a-z][a-z0-9_]*$/),
    image: z.string().min(1).max(200),
    tileWidth: z.number().int().min(8).max(256),
    tileHeight: z.number().int().min(8).max(256),
    columns: z.number().int().min(1).max(64),
    tileCount: z.number().int().min(1).max(1_024),
  })
  .strict();

export type MapTileset = z.infer<typeof tilesetSchema>;

export const mapPortalSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(1).max(32),
    tile: tilePointSchema,
    targetMapId: mapIdSchema,
    targetTile: tilePointSchema,
  })
  .strict();

export type MapPortal = z.infer<typeof mapPortalSchema>;

export const MAP_NPC_ROLES = ['merchant', 'guard', 'scout'] as const;
export const mapNpcRoleSchema = z.enum(MAP_NPC_ROLES);
export type MapNpcRole = z.infer<typeof mapNpcRoleSchema>;

export const mapNpcPointSchema = z
  .object({
    id: z.string().min(1).max(32),
    name: z.string().min(1).max(32),
    tile: tilePointSchema,
    /** Interaction the server enforces; absent NPCs are decoration only. */
    role: mapNpcRoleSchema.optional(),
  })
  .strict();

export type MapNpcPoint = z.infer<typeof mapNpcPointSchema>;

export const mapMonsterSpawnSchema = z
  .object({
    id: z.string().min(1).max(32),
    monsterId: z.string().min(1).max(32),
    tile: tilePointSchema,
  })
  .strict();

export type MapMonsterSpawn = z.infer<typeof mapMonsterSpawnSchema>;

export const mapRuntimeManifestSchema = z
  .object({
    schemaVersion: z.literal(MAP_RUNTIME_SCHEMA_VERSION),
    mapId: mapIdSchema,
    name: z.string().min(1).max(64),
    kind: z.enum(['town', 'wilds']),
    /**
     * Server-enforced player-combat rule for this map. The browser renders the
     * badge from the same manifest, but only the server copy decides whether a
     * player attack is legal (ADR-021).
     */
    pvpMode: z.enum(['none', 'open']),
    width: z.number().int().min(4).max(256),
    height: z.number().int().min(4).max(256),
    tileWidth: z.number().int().min(8).max(256),
    tileHeight: z.number().int().min(8).max(256),
    tileset: tilesetSchema,
    layers: z
      .object({
        ground: layerSchema,
        decoLow: layerSchema,
        decoHigh: layerSchema,
        /** 1 = blocked, 0 = walkable. */
        collision: layerSchema,
      })
      .strict(),
    spawnPoints: z.array(tilePointSchema).min(1).max(64),
    /**
     * Where defeated players revive. Optional for manifests compiled before
     * the field existed; the runtime falls back to the first spawn point.
     */
    respawnPoint: tilePointSchema.optional(),
    portals: z.array(mapPortalSchema).max(64),
    npcPoints: z.array(mapNpcPointSchema).max(64),
    monsterSpawns: z.array(mapMonsterSpawnSchema).max(128),
    assetManifestVersion: z.string().min(1).max(64),
    checksum: z.string().regex(/^[0-9a-f]{64}$/, 'checksum must be a lowercase sha256 hex digest'),
  })
  .strict()
  .superRefine((map, ctx) => {
    const cellCount = map.width * map.height;
    for (const layerName of ['ground', 'decoLow', 'decoHigh', 'collision'] as const) {
      if (map.layers[layerName].length !== cellCount) {
        ctx.addIssue({
          code: 'custom',
          path: ['layers', layerName],
          message: `expected ${String(cellCount)} cells, received ${String(map.layers[layerName].length)}`,
        });
      }
    }
    if (map.tileset.tileCount > map.tileset.columns * 256) {
      ctx.addIssue({
        code: 'custom',
        path: ['tileset', 'tileCount'],
        message: 'tileset tileCount does not fit its columns',
      });
    }

    const isInside = (point: { x: number; y: number }): boolean =>
      point.x >= 0 && point.y >= 0 && point.x < map.width && point.y < map.height;

    const isWalkable = (point: { x: number; y: number }): boolean =>
      isInside(point) && map.layers.collision[point.y * map.width + point.x] === 0;

    map.spawnPoints.forEach((point, index) => {
      if (!isWalkable(point)) {
        ctx.addIssue({
          code: 'custom',
          path: ['spawnPoints', index],
          message: 'spawn point must be inside the map and walkable',
        });
      }
    });

    if (map.respawnPoint !== undefined && !isWalkable(map.respawnPoint)) {
      ctx.addIssue({
        code: 'custom',
        path: ['respawnPoint'],
        message: 'respawn point must be inside the map and walkable',
      });
    }

    map.portals.forEach((portal, index) => {
      if (!isWalkable(portal.tile)) {
        ctx.addIssue({
          code: 'custom',
          path: ['portals', index, 'tile'],
          message: 'portal must be inside the map and walkable',
        });
      }
    });

    map.npcPoints.forEach((npc, index) => {
      if (!isWalkable(npc.tile)) {
        ctx.addIssue({
          code: 'custom',
          path: ['npcPoints', index, 'tile'],
          message: 'NPC must be inside the map and walkable',
        });
      }
    });

    map.monsterSpawns.forEach((spawn, index) => {
      if (!isWalkable(spawn.tile)) {
        ctx.addIssue({
          code: 'custom',
          path: ['monsterSpawns', index, 'tile'],
          message: 'monster spawn must be inside the map and walkable',
        });
      }
    });
  });

export type MapRuntimeManifest = z.infer<typeof mapRuntimeManifestSchema>;

export type MapPvpMode = MapRuntimeManifest['pvpMode'];

export function isPvpEnabled(map: Pick<MapRuntimeManifest, 'pvpMode'>): boolean {
  return map.pvpMode === 'open';
}

/**
 * The tile where defeated players revive. Manifests compiled before the field
 * existed keep their old behaviour: the first spawn point.
 */
export function playerRespawnPointOf(
  map: Pick<MapRuntimeManifest, 'respawnPoint' | 'spawnPoints'>,
): { x: number; y: number } {
  const point = map.respawnPoint ?? map.spawnPoints[0];
  if (point === undefined) {
    throw new Error('map manifest has no spawn point to revive at');
  }
  return point;
}

export function isMapPointInside(
  map: Pick<MapRuntimeManifest, 'width' | 'height'>,
  point: { x: number; y: number },
): boolean {
  return (
    Number.isInteger(point.x) &&
    Number.isInteger(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < map.width &&
    point.y < map.height
  );
}

export function isMapTileWalkable(
  map: Pick<MapRuntimeManifest, 'width' | 'height' | 'layers'>,
  x: number,
  y: number,
): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
    return false;
  }
  return map.layers.collision[y * map.width + x] === 0;
}

/** Colyseus room type for one map template instance (ADR-018). */
export function worldRoomNameFor(mapId: string): string {
  return `world_map:${mapId}`;
}

export function mapIdFromRoomName(roomName: string): string | null {
  const prefix = 'world_map:';
  if (!roomName.startsWith(prefix)) {
    return null;
  }
  const mapId = roomName.slice(prefix.length);
  return mapIdSchema.safeParse(mapId).success ? mapId : null;
}
