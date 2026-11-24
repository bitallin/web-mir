import {
  assetManifestSchema,
  type AssetCharacter,
  type AssetManifest,
  type AssetTile,
  type AssetTileset,
  type MapRuntimeManifest,
} from '@web-legend/contracts';
import { STARTER_TOWN_MAP, findMapManifest } from '@web-legend/contracts/maps';

import rawAssetManifest from '../../../../content/assets/manifest.json';

const assetManifest: AssetManifest = assetManifestSchema.parse(rawAssetManifest);

const TERRAIN_IMAGE_URL = new URL(
  '../../../../content/assets/generated/starter_terrain.png',
  import.meta.url,
).href;
const PLAYER_IMAGE_URL = new URL(
  '../../../../content/assets/generated/player_placeholder.png',
  import.meta.url,
).href;

export type MapBundle = {
  manifest: MapRuntimeManifest;
  tileset: AssetTileset;
  tilesByGid: ReadonlyMap<number, AssetTile>;
  terrainImageUrl: string;
  player: AssetCharacter;
  playerImageUrl: string;
};

function requireTileset(): AssetTileset {
  const tileset = assetManifest.tilesets.terrain;
  if (tileset === undefined) {
    throw new Error('asset manifest has no terrain tileset');
  }
  return tileset;
}

function requirePlayer(): AssetCharacter {
  const player = assetManifest.characters.player_placeholder;
  if (player === undefined) {
    throw new Error('asset manifest has no player character');
  }
  return player;
}

/**
 * Resolves the compiled map manifest and its tileset. An unknown map id falls
 * back to the starter town for rendering only; the server still rejects a
 * character whose persisted map this build does not run.
 */
export function mapBundleFor(mapId: string): MapBundle {
  const manifest = findMapManifest(mapId) ?? STARTER_TOWN_MAP;
  const tileset = requireTileset();
  const player = requirePlayer();
  return {
    manifest,
    tileset,
    tilesByGid: new Map(tileset.tiles.map((tile) => [tile.gid, tile])),
    terrainImageUrl: TERRAIN_IMAGE_URL,
    player,
    playerImageUrl: PLAYER_IMAGE_URL,
  };
}

export function mapNameFor(mapId: string): string {
  return findMapManifest(mapId)?.name ?? STARTER_TOWN_MAP.name;
}

export { assetManifest };
