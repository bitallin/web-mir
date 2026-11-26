import { describe, expect, it } from 'vitest';

import rawAssetManifest from '../../../content/assets/manifest.json';
import { assetManifestSchema } from './assets';
import {
  MAP_MANIFESTS,
  RUINED_FIELDS_MAP,
  STARTER_TOWN_MAP,
  STARTER_TOWN_MAP_ID,
  STARTER_WILDS_MAP,
  findMapManifest,
} from './maps';
import {
  isPvpEnabled,
  mapIdFromRoomName,
  mapRuntimeManifestSchema,
  worldRoomNameFor,
} from './mapRuntime';
import { chatSendSchema, sessionTransferSchema } from './realtime';

describe('compiled maps', () => {
  it('loads every compiled map and resolves them by id', () => {
    expect(MAP_MANIFESTS.map((map) => map.mapId).sort()).toEqual([
      'ruined_fields',
      'starter_town',
      'starter_wilds',
    ]);
    expect(findMapManifest(STARTER_TOWN_MAP_ID)).toBe(STARTER_TOWN_MAP);
    expect(findMapManifest('missing_map')).toBeUndefined();
    expect(STARTER_TOWN_MAP.portals[0]?.targetMapId).toBe(STARTER_WILDS_MAP.mapId);
    expect(STARTER_WILDS_MAP.portals[0]?.targetMapId).toBe(STARTER_TOWN_MAP.mapId);
  });

  it('links the town to the ruins in both directions', () => {
    const townToRuins = STARTER_TOWN_MAP.portals.find(
      (portal) => portal.targetMapId === RUINED_FIELDS_MAP.mapId,
    );
    const ruinsToTown = RUINED_FIELDS_MAP.portals.find(
      (portal) => portal.targetMapId === STARTER_TOWN_MAP.mapId,
    );
    expect(townToRuins).toBeDefined();
    expect(ruinsToTown).toBeDefined();
    // Arrival sits next to the return portal so the player never lands on it.
    expect(ruinsToTown?.targetTile).not.toEqual(townToRuins?.tile);
    expect(
      Math.abs((ruinsToTown?.targetTile.x ?? 0) - (townToRuins?.tile.x ?? 0)) +
        Math.abs((ruinsToTown?.targetTile.y ?? 0) - (townToRuins?.tile.y ?? 0)),
    ).toBe(1);
    expect(RUINED_FIELDS_MAP.pvpMode).toBe('open');
    for (const portal of [...STARTER_TOWN_MAP.portals, ...RUINED_FIELDS_MAP.portals]) {
      expect(MAP_MANIFESTS.some((map) => map.mapId === portal.targetMapId)).toBe(true);
    }
  });

  it('compiles the town as a safe zone and the wilds as open pvp', () => {
    expect(STARTER_TOWN_MAP.pvpMode).toBe('none');
    expect(STARTER_WILDS_MAP.pvpMode).toBe('open');
    expect(isPvpEnabled(STARTER_TOWN_MAP)).toBe(false);
    expect(isPvpEnabled(STARTER_WILDS_MAP)).toBe(true);
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

  it('rejects an unknown pvp mode', () => {
    const broken = { ...STARTER_TOWN_MAP, pvpMode: 'duel-everywhere' };
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
    expect(Object.keys(manifest.maps).sort()).toEqual([
      'ruined_fields',
      'starter_town',
      'starter_wilds',
    ]);
  });

  it('gives every class its own sheet and clip table', () => {
    const manifest = assetManifestSchema.parse(rawAssetManifest);
    for (const classId of ['warrior', 'mage', 'taoist']) {
      const character = manifest.characters[classId];
      expect(character?.image).toBe(`class_${classId}.png`);
      expect(character?.animations?.walk?.frames).toEqual([1, 2]);
      expect(character?.animations?.death?.frames).toEqual([8, 9]);
      expect(character?.animations?.death?.loop).toBe(false);
    }
  });

  it('rejects a clip that points past the sheet width', () => {
    const manifest = assetManifestSchema.parse(rawAssetManifest);
    const warrior = manifest.characters.warrior;
    if (warrior === undefined) {
      throw new Error('warrior character is missing');
    }
    const broken = {
      ...manifest,
      characters: {
        ...manifest.characters,
        warrior: {
          ...warrior,
          animations: { ...warrior.animations, idle: { frames: [10], frameMs: 100, loop: true } },
        },
      },
    };
    expect(assetManifestSchema.safeParse(broken).success).toBe(false);
  });

  it('rejects a clip that repeats a frame', () => {
    const manifest = assetManifestSchema.parse(rawAssetManifest);
    const mage = manifest.characters.mage;
    if (mage === undefined) {
      throw new Error('mage character is missing');
    }
    const broken = {
      ...manifest,
      characters: {
        ...manifest.characters,
        mage: {
          ...mage,
          animations: { ...mage.animations, walk: { frames: [1, 1], frameMs: 100, loop: true } },
        },
      },
    };
    expect(assetManifestSchema.safeParse(broken).success).toBe(false);
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
