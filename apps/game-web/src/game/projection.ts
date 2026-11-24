import { TILE_UNITS, type TilePoint } from '@web-legend/contracts';

export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;

export type ScreenPoint = {
  x: number;
  y: number;
};

export type Projection = {
  /** Screen position of a logical position in integer sub-tile units. */
  toScreen: (unitsX: number, unitsY: number) => ScreenPoint;
  /** Screen center of a tile. */
  tileCenter: (tile: TilePoint) => ScreenPoint;
  /** Logical tile under a screen point. */
  toTile: (screenX: number, screenY: number) => TilePoint;
  mapWidth: number;
  mapHeight: number;
};

/**
 * Pseudo-isometric projection. Logical integer tile coordinates denote grid
 * corners; a player standing at the center of tile (x, y) renders at the center
 * of that tile's diamond. Collision and movement never use these pixels.
 */
export function createProjection(map: { width: number; height: number }): Projection {
  const halfTileWidth = TILE_WIDTH / 2;
  const halfTileHeight = TILE_HEIGHT / 2;
  // Shift the diamond so every screen coordinate stays positive.
  const offsetX = map.height * halfTileWidth;

  const toScreen = (unitsX: number, unitsY: number): ScreenPoint => {
    const tileX = unitsX / TILE_UNITS;
    const tileY = unitsY / TILE_UNITS;
    return {
      x: (tileX - tileY) * halfTileWidth + offsetX,
      y: (tileX + tileY) * halfTileHeight,
    };
  };

  return {
    toScreen,
    tileCenter: (tile) =>
      toScreen(tile.x * TILE_UNITS + TILE_UNITS / 2, tile.y * TILE_UNITS + TILE_UNITS / 2),
    toTile: (screenX, screenY) => {
      const diagonal = (screenX - offsetX) / halfTileWidth;
      const sum = screenY / halfTileHeight;
      return {
        x: Math.floor((diagonal + sum) / 2),
        y: Math.floor((sum - diagonal) / 2),
      };
    },
    mapWidth: (map.width + map.height) * halfTileWidth,
    mapHeight: (map.width + map.height) * halfTileHeight,
  };
}
