import type { MapPortal, MapRuntimeManifest, TilePoint } from '@web-legend/contracts';
import { findPath } from '@web-legend/game-simulation';
import type { MapRuntime } from '@web-legend/map-runtime';

/**
 * Pure route planning for one-click quest guidance (ADR-039). The room owns
 * the movement; these helpers only answer "which map hop, which spawn, which
 * walkable tile near the giver", so they are deterministic and unit-testable.
 */

export type QuestRouteHop = {
  /** Map the character enters after walking onto `portalTile`. */
  mapId: string;
  portalTile: TilePoint;
  portal: MapPortal;
};

/** Maps that spawn any of the target monsters. */
export function mapsWithAnyMonsterSpawn(
  maps: readonly MapRuntimeManifest[],
  monsterIds: ReadonlySet<string>,
): string[] {
  return maps
    .filter((map) => map.monsterSpawns.some((spawn) => monsterIds.has(spawn.monsterId)))
    .map((map) => map.mapId);
}

/** Maps that place the quest giver NPC. */
export function mapsWithNpc(maps: readonly MapRuntimeManifest[], npcId: string): string[] {
  return maps
    .filter((map) => map.npcPoints.some((npc) => npc.id === npcId))
    .map((map) => map.mapId);
}

/**
 * First portal on the shortest route from `currentMapId` to any target map.
 * Returns null when the current map is already a target or no route exists.
 */
export function nextPortalToward(
  maps: readonly MapRuntimeManifest[],
  currentMapId: string,
  targetMapIds: ReadonlySet<string>,
): QuestRouteHop | null {
  if (targetMapIds.has(currentMapId)) {
    return null;
  }
  const byId = new Map(maps.map((map) => [map.mapId, map]));
  const queue: { mapId: string; firstHop: QuestRouteHop | null }[] = [
    { mapId: currentMapId, firstHop: null },
  ];
  const seen = new Set([currentMapId]);
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) {
      break;
    }
    const map = byId.get(node.mapId);
    if (map === undefined) {
      continue;
    }
    const portals = [...map.portals].sort((left, right) => left.id.localeCompare(right.id));
    for (const portal of portals) {
      if (seen.has(portal.targetMapId)) {
        continue;
      }
      const hop = node.firstHop ?? {
        mapId: portal.targetMapId,
        portalTile: portal.tile,
        portal,
      };
      if (targetMapIds.has(portal.targetMapId)) {
        return hop;
      }
      seen.add(portal.targetMapId);
      queue.push({ mapId: portal.targetMapId, firstHop: hop });
    }
  }
  return null;
}

/**
 * Closest spawn tile among the target monsters. Ties resolve by tile order so
 * repeated planning does not oscillate between two equidistant spawns.
 */
export function nearestSpawnTileAmong(
  map: MapRuntimeManifest,
  monsterIds: ReadonlySet<string>,
  from: TilePoint,
): TilePoint | null {
  let best: TilePoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const spawn of map.monsterSpawns) {
    if (!monsterIds.has(spawn.monsterId)) {
      continue;
    }
    const distance = (spawn.tile.x - from.x) ** 2 + (spawn.tile.y - from.y) ** 2;
    if (
      distance < bestDistance ||
      (distance === bestDistance &&
        best !== null &&
        (spawn.tile.y < best.y || (spawn.tile.y === best.y && spawn.tile.x < best.x)))
    ) {
      best = spawn.tile;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Shortest walkable path that ends within `rangeTiles` of the NPC. The NPC tile
 * itself is often blocked, so the helper searches the surrounding tiles and
 * picks the reachable one with the shortest path from the player.
 */
export function findNpcApproachPath(
  runtime: MapRuntime,
  npcTile: TilePoint,
  from: TilePoint,
  rangeTiles: number,
): TilePoint[] | null {
  const radius = Math.ceil(rangeTiles);
  let best: TilePoint[] | null = null;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (Math.hypot(dx, dy) > rangeTiles) {
        continue;
      }
      const tile = { x: npcTile.x + dx, y: npcTile.y + dy };
      if (!runtime.isWalkable(tile.x, tile.y)) {
        continue;
      }
      const path = findPath(runtime.grid, from, tile);
      if (path === null) {
        continue;
      }
      if (best === null || path.length < best.length) {
        best = path;
      }
    }
  }
  return best;
}
