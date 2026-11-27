import type { TilePoint } from '@web-legend/contracts';

/**
 * The movement domain only needs walkability. The server adapts a compiled
 * map runtime (or any other navigation source) to this shape.
 */
export type MovementGrid = {
  width: number;
  height: number;
  isWalkable: (x: number, y: number) => boolean;
};

export function isInsideGrid(grid: MovementGrid, point: TilePoint): boolean {
  return (
    Number.isInteger(point.x) &&
    Number.isInteger(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < grid.width &&
    point.y < grid.height
  );
}

export function isStandable(grid: MovementGrid, point: TilePoint): boolean {
  return isInsideGrid(grid, point) && grid.isWalkable(point.x, point.y);
}

/**
 * Eight-direction step rule shared by the pathfinder and the simulation's
 * path validation. A diagonal step is legal only when both orthogonal
 * neighbours are walkable, so a character can never cut a blocked corner.
 */
export function isStepAllowed(grid: MovementGrid, from: TilePoint, to: TilePoint): boolean {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  if (deltaX === 0 && deltaY === 0) {
    return false;
  }
  if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
    return false;
  }
  if (!isStandable(grid, to)) {
    return false;
  }
  if (deltaX !== 0 && deltaY !== 0) {
    return (
      isStandable(grid, { x: from.x + deltaX, y: from.y }) &&
      isStandable(grid, { x: from.x, y: from.y + deltaY })
    );
  }
  return true;
}
