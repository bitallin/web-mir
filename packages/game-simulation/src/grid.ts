import { isTileWalkable, type MapManifest, type TilePoint } from '@web-legend/contracts';

/**
 * The movement domain only needs walkability; the phase 1 test map manifest
 * satisfies it now, and the phase 3 compiled navigation grid will as well.
 */
export type MovementGrid = {
  width: number;
  height: number;
  isWalkable: (x: number, y: number) => boolean;
};

export function gridFromManifest(map: MapManifest): MovementGrid {
  return {
    width: map.width,
    height: map.height,
    isWalkable: (x, y) => isTileWalkable(map, x, y),
  };
}

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
