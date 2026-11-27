import {
  TILE_UNITS,
  type ContentBundle,
  type MapMonsterSpawn,
  type TilePoint,
} from '@web-legend/contracts';
import { createSeededRng } from '@web-legend/testkit';

import { CombatWorld, type CombatGrid, type CombatWorldOptions } from './combatWorld';

export function center(tile: TilePoint): { x: number; y: number } {
  return {
    x: tile.x * TILE_UNITS + TILE_UNITS / 2,
    y: tile.y * TILE_UNITS + TILE_UNITS / 2,
  };
}

export function createFlatGrid(size = 20, blocked: readonly TilePoint[] = []): CombatGrid {
  const blockedKeys = new Set(blocked.map((tile) => `${String(tile.x)}:${String(tile.y)}`));
  return {
    width: size,
    height: size,
    isWalkable: (x, y) =>
      x >= 0 && y >= 0 && x < size && y < size && !blockedKeys.has(`${String(x)}:${String(y)}`),
  };
}

/** Eight-directional BFS matching the server pathfinder's contract (ADR-043). */
export function bfsPath(
  grid: CombatGrid,
  from: TilePoint,
  to: TilePoint,
): readonly TilePoint[] | null {
  if (!grid.isWalkable(from.x, from.y) || !grid.isWalkable(to.x, to.y)) {
    return null;
  }
  const key = (point: TilePoint): string => `${String(point.x)}:${String(point.y)}`;
  const previous = new Map<string, TilePoint>();
  const queue: TilePoint[] = [from];
  const visited = new Set<string>([key(from)]);
  const offsets = [
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: 0 },
    { x: -1, y: -1 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    if (current.x === to.x && current.y === to.y) {
      const path: TilePoint[] = [];
      let cursor: TilePoint | undefined = current;
      while (cursor !== undefined && !(cursor.x === from.x && cursor.y === from.y)) {
        path.push(cursor);
        cursor = previous.get(key(cursor));
      }
      return path.reverse();
    }
    for (const offset of offsets) {
      const next = { x: current.x + offset.x, y: current.y + offset.y };
      if (!grid.isWalkable(next.x, next.y) || visited.has(key(next))) {
        continue;
      }
      if (
        offset.x !== 0 &&
        offset.y !== 0 &&
        (!grid.isWalkable(current.x + offset.x, current.y) ||
          !grid.isWalkable(current.x, current.y + offset.y))
      ) {
        continue;
      }
      visited.add(key(next));
      previous.set(key(next), current);
      queue.push(next);
    }
  }
  return null;
}

export const DEFAULT_SLIME_SPAWN: MapMonsterSpawn = {
  id: 'wilds_slime_1',
  monsterId: 'wild_slime',
  tile: { x: 5, y: 5 },
};

export type TestWorldOptions = {
  spawns?: readonly MapMonsterSpawn[];
  seed?: number | string;
  grid?: CombatGrid;
  playerRespawnTile?: TilePoint;
  pvpEnabled?: boolean;
  monsterRespawnMs?: number;
  playerRespawnMs?: number;
  content?: ContentBundle;
  tuning?: Pick<Partial<CombatWorldOptions>, 'skills' | 'monsters'>;
};

export function createTestWorld(options: TestWorldOptions = {}): CombatWorld {
  return new CombatWorld({
    spawns: options.spawns ?? [DEFAULT_SLIME_SPAWN],
    grid: options.grid ?? createFlatGrid(),
    pathfinder: bfsPath,
    rng: createSeededRng(options.seed ?? 'phase4-test'),
    playerRespawnTile: options.playerRespawnTile ?? { x: 1, y: 1 },
    pvpEnabled: options.pvpEnabled ?? false,
    monsterRespawnMs: options.monsterRespawnMs ?? 500,
    playerRespawnMs: options.playerRespawnMs ?? 500,
    ...(options.content === undefined ? {} : { content: options.content }),
    ...(options.tuning ?? {}),
  });
}

export function positions(world: CombatWorld): Map<string, { x: number; y: number }> {
  return new Map(world.listPlayers().map((player) => [player.id, { x: player.x, y: player.y }]));
}

export function advance(world: CombatWorld, totalMs: number, stepMs = 50): number {
  let elapsed = 0;
  while (elapsed < totalMs) {
    const step = Math.min(stepMs, totalMs - elapsed);
    world.step(step, positions(world));
    elapsed += step;
  }
  return elapsed;
}
