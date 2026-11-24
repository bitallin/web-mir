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
