import {
  assetManifestSchema,
  type AssetCharacter,
  type AssetManifest,
  type AssetTile,
  type AssetTileset,
  type MapRuntimeManifest,
} from '@web-legend/contracts';
import { MAP_MANIFESTS, STARTER_TOWN_MAP, findMapManifest } from '@web-legend/contracts/maps';

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
const CLASS_IMAGE_URLS: Readonly<Record<string, string>> = {
  warrior: new URL('../../../../content/assets/generated/class_warrior.png', import.meta.url).href,
  mage: new URL('../../../../content/assets/generated/class_mage.png', import.meta.url).href,
  taoist: new URL('../../../../content/assets/generated/class_taoist.png', import.meta.url).href,
};
export const ITEM_ICON_ATLAS_URL = new URL(
  '../../../../content/assets/generated/item_icons.png',
  import.meta.url,
).href;
export const ITEM_ICON_TEXTURE_KEY = 'item-icons';

export type CharacterAsset = {
  /** Phaser texture key. */
  key: string;
  character: AssetCharacter;
  imageUrl: string;
};

export type MapBundle = {
  manifest: MapRuntimeManifest;
  tileset: AssetTileset;
  tilesByGid: ReadonlyMap<number, AssetTile>;
  terrainImageUrl: string;
  /** Shared fallback sheet, also used when a class sheet is missing. */
  fallbackCharacter: CharacterAsset;
  characters: ReadonlyMap<string, CharacterAsset>;
};

function requireTileset(): AssetTileset {
  const tileset = assetManifest.tilesets.terrain;
  if (tileset === undefined) {
    throw new Error('asset manifest has no terrain tileset');
  }
  return tileset;
}

function requireFallbackCharacter(): CharacterAsset {
  const character = assetManifest.characters.player_placeholder;
  if (character === undefined) {
    throw new Error('asset manifest has no player character');
  }
  return { key: 'characters', character, imageUrl: PLAYER_IMAGE_URL };
}

function classCharacters(): ReadonlyMap<string, CharacterAsset> {
  const characters = new Map<string, CharacterAsset>();
  for (const [id, url] of Object.entries(CLASS_IMAGE_URLS)) {
    const character = assetManifest.characters[id];
    if (character === undefined) {
      continue;
    }
    characters.set(id, { key: `character-${id}`, character, imageUrl: url });
  }
  return characters;
}

/**
 * Resolves the compiled map manifest and its tileset. An unknown map id falls
 * back to the starter town for rendering only; the server still rejects a
 * character whose persisted map this build does not run.
 */
export function mapBundleFor(mapId: string): MapBundle {
  const manifest = findMapManifest(mapId) ?? STARTER_TOWN_MAP;
  const tileset = requireTileset();
  return {
    manifest,
    tileset,
    tilesByGid: new Map(tileset.tiles.map((tile) => [tile.gid, tile])),
    terrainImageUrl: TERRAIN_IMAGE_URL,
    fallbackCharacter: requireFallbackCharacter(),
    characters: classCharacters(),
  };
}

export function mapNameFor(mapId: string): string {
  return findMapManifest(mapId)?.name ?? STARTER_TOWN_MAP.name;
}

export type NpcLocation = {
  mapId: string;
  mapName: string;
  npcName: string;
};

/**
 * Resolves where a quest giver lives. The world map is small enough that the
 * compiled manifests are already in the bundle; a quest from another map can
 * therefore still show its destination without a server round trip.
 */
export function locateNpc(npcId: string): NpcLocation | null {
  for (const map of MAP_MANIFESTS) {
    const npc = map.npcPoints.find((point) => point.id === npcId);
    if (npc !== undefined) {
      return { mapId: map.mapId, mapName: map.name, npcName: npc.name };
    }
  }
  return null;
}

export { assetManifest };
