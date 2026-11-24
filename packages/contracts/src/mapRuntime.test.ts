import { describe, expect, it } from 'vitest';

import rawAssetManifest from '../../../content/assets/manifest.json';
import { assetManifestSchema } from './assets';
import {
  MAP_MANIFESTS,
  STARTER_TOWN_MAP,
  STARTER_TOWN_MAP_ID,
  STARTER_WILDS_MAP,
  findMapManifest,
} from './maps';
import { mapIdFromRoomName, mapRuntimeManifestSchema, worldRoomNameFor } from './mapRuntime';
import { chatSendSchema, sessionTransferSchema } from './realtime';

describe('compiled maps', () => {
  it('loads both starter maps and resolves them by id', () => {
    expect(MAP_MANIFESTS.map((map) => map.mapId).sort()).toEqual(['starter_town', 'starter_wilds']);
    expect(findMapManifest(STARTER_TOWN_MAP_ID)).toBe(STARTER_TOWN_MAP);
    expect(findMapManifest('missing_map')).toBeUndefined();
    expect(STARTER_TOWN_MAP.portals[0]?.targetMapId).toBe(STARTER_WILDS_MAP.mapId);
    expect(STARTER_WILDS_MAP.portals[0]?.targetMapId).toBe(STARTER_TOWN_MAP.mapId);
  });

  it('rejects layer sizes that do not match the map', () => {
    const broken = {
      ...STARTER_TOWN_MAP,
      layers: {
        ...STARTER_TOWN_MAP.layers,
        ground: STARTER_TOWN_MAP.layers.ground.slice(0, -1),
      },
    };
    expect(mapRuntimeManifestSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a spawn point on a blocked tile', () => {
    const blockedSpawn = {
      ...STARTER_TOWN_MAP,
      spawnPoints: [{ x: 0, y: 0 }],
    };
    expect(mapRuntimeManifestSchema.safeParse(blockedSpawn).success).toBe(false);
  });

  it('rejects a checksum with the wrong shape', () => {
    const broken = { ...STARTER_TOWN_MAP, checksum: 'not-a-digest' };
    expect(mapRuntimeManifestSchema.safeParse(broken).success).toBe(false);
  });
});

describe('room names', () => {
  it('round-trips the map id encoded in a room type', () => {
    const roomName = worldRoomNameFor('starter_town');
    expect(roomName).toBe('world_map:starter_town');
    expect(mapIdFromRoomName(roomName)).toBe('starter_town');
    expect(mapIdFromRoomName('world_map:')).toBeNull();
    expect(mapIdFromRoomName('diagnostics')).toBeNull();
    expect(mapIdFromRoomName('world_map:Bad Id')).toBeNull();
  });
});

describe('chat and transfer messages', () => {
  it('accepts a normal chat message and rejects invalid payloads', () => {
    const valid = {
      protocolVersion: 1,
      clientMessageId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      message: '有人一起打怪吗？',
    };
    expect(chatSendSchema.safeParse(valid).success).toBe(true);
    expect(chatSendSchema.safeParse({ ...valid, message: 'x'.repeat(121) }).success).toBe(false);
    expect(chatSendSchema.safeParse({ ...valid, message: '   ' }).success).toBe(false);
    expect(chatSendSchema.safeParse({ ...valid, message: 'bad\u0000message' }).success).toBe(false);
    expect(chatSendSchema.safeParse({ ...valid, position: { x: 1, y: 1 } }).success).toBe(false);
  });

  it('accepts a server transfer instruction and rejects bad map ids', () => {
    expect(sessionTransferSchema.safeParse({ mapId: 'starter_wilds', serverTime: 1 }).success).toBe(
      true,
    );
    expect(sessionTransferSchema.safeParse({ mapId: 'Bad Map', serverTime: 1 }).success).toBe(
      false,
    );
    expect(sessionTransferSchema.safeParse({ mapId: 'starter_wilds' }).success).toBe(false);
  });
});

describe('asset manifest', () => {
  it('validates the checked-in placeholder assets', () => {
    const manifest = assetManifestSchema.parse(rawAssetManifest);
    expect(manifest.tilesets.terrain?.tileCount).toBe(8);
    expect(manifest.characters.player_placeholder?.frames).toBe(2);
    expect(Object.keys(manifest.maps).sort()).toEqual(['starter_town', 'starter_wilds']);
  });

  it('rejects a tileset whose gids are not contiguous', () => {
    const manifest = assetManifestSchema.parse(rawAssetManifest);
    const terrain = manifest.tilesets.terrain;
    if (terrain === undefined) {
      throw new Error('terrain tileset is missing');
    }
    const broken = {
      ...manifest,
      tilesets: {
        ...manifest.tilesets,
        terrain: { ...terrain, tiles: terrain.tiles.slice(1) },
      },
    };
    expect(assetManifestSchema.safeParse(broken).success).toBe(false);
  });
});
