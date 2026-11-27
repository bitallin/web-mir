import type { TilePoint } from '@web-legend/contracts';

import { isInsideGrid, isStandable, type MovementGrid } from './grid';

/**
 * Clockwise order from north. Deterministic neighbour order keeps equal-length
 * paths identical across runs.
 */
const NEIGHBOURS: readonly TilePoint[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

/**
 * Deterministic eight-directional breadth-first search. Returns the tile
 * centers to walk through after `from` (excluding `from`, including `to`), or
 * null when the target is not reachable. A diagonal step requires both
 * orthogonal neighbours to be walkable, so paths never cut a blocked corner
 * (ADR-043). The server is the only authority that calls this; clients render
 * the accepted path.
 */
export function findPath(grid: MovementGrid, from: TilePoint, to: TilePoint): TilePoint[] | null {
  if (!isStandable(grid, from) || !isStandable(grid, to)) {
    return null;
  }
  if (from.x === to.x && from.y === to.y) {
    return [];
  }

  const width = grid.width;
  const height = grid.height;
  const visited = new Uint8Array(width * height);
  const previous = new Int32Array(width * height).fill(-1);

  const startIndex = from.y * width + from.x;
  const targetIndex = to.y * width + to.x;
  visited[startIndex] = 1;

  const queue: number[] = [startIndex];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    if (current === undefined) {
      break;
    }
    if (current === targetIndex) {
      break;
    }

    const currentX = current % width;
    const currentY = (current - currentX) / width;

    // Expand the neighbour closest to the target first: BFS still returns a
    // minimum-step path, but ties now prefer a natural straight line instead
    // of an equally short detour one row over.
    const candidates: { x: number; y: number; score: number }[] = [];
    for (const offset of NEIGHBOURS) {
      const nextX = currentX + offset.x;
      const nextY = currentY + offset.y;
      const next = { x: nextX, y: nextY };
      if (!isInsideGrid(grid, next) || !grid.isWalkable(nextX, nextY)) {
        continue;
      }
      if (
        offset.x !== 0 &&
        offset.y !== 0 &&
        (!grid.isWalkable(currentX + offset.x, currentY) ||
          !grid.isWalkable(currentX, currentY + offset.y))
      ) {
        continue;
      }
      const nextIndex = nextY * width + nextX;
      if (visited[nextIndex] === 1) {
        continue;
      }
      candidates.push({
        x: nextX,
        y: nextY,
        score: Math.hypot(nextX - to.x, nextY - to.y),
      });
    }
    candidates.sort((left, right) => left.score - right.score);
    for (const candidate of candidates) {
      const nextIndex = candidate.y * width + candidate.x;
      if (visited[nextIndex] === 1) {
        continue;
      }
      visited[nextIndex] = 1;
      previous[nextIndex] = current;
      queue.push(nextIndex);
    }
  }

  if (visited[targetIndex] !== 1) {
    return null;
  }

  const reversed: TilePoint[] = [];
  let cursor = targetIndex;
  while (cursor !== startIndex && cursor !== -1) {
    const x = cursor % width;
    const y = (cursor - x) / width;
    reversed.push({ x, y });
    cursor = previous[cursor] ?? -1;
  }

  return reversed.reverse();
}
