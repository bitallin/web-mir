import {
  TILE_UNITS,
  type MapPortal,
  type MapRuntimeManifest,
  type TilePoint,
} from '@web-legend/contracts';

import { verifyManifestChecksum } from './checksum';

export type MovementGridShape = {
  width: number;
  height: number;
  isWalkable: (x: number, y: number) => boolean;
};

export type MapRuntime = {
  manifest: MapRuntimeManifest;
  grid: MovementGridShape;
  isWalkable: (x: number, y: number) => boolean;
  isStandable: (tile: TilePoint) => boolean;
  tileOfUnits: (x: number, y: number) => TilePoint;
  portalAt: (tile: TilePoint) => MapPortal | undefined;
  portals: readonly MapPortal[];
};

export function createMapRuntime(manifest: MapRuntimeManifest): MapRuntime {
  if (!verifyManifestChecksum(manifest)) {
    throw new Error(`map "${manifest.mapId}" checksum does not match its content`);
  }

  const width = manifest.width;
  const height = manifest.height;
  const isWalkable = (x: number, y: number): boolean =>
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < width &&
    y < height &&
    manifest.layers.collision[y * width + x] === 0;

  const portalsByTile = new Map<string, MapPortal>(
    manifest.portals.map((portal) => [`${String(portal.tile.x)}:${String(portal.tile.y)}`, portal]),
  );

  return {
    manifest,
    grid: { width, height, isWalkable },
    isWalkable,
    isStandable: (tile) => isWalkable(tile.x, tile.y),
    tileOfUnits: (x, y) => ({ x: Math.floor(x / TILE_UNITS), y: Math.floor(y / TILE_UNITS) }),
    portalAt: (tile) => portalsByTile.get(`${String(tile.x)}:${String(tile.y)}`),
    portals: manifest.portals,
  };
}
