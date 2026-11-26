import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { assetManifestSchema, type MapTileset } from '@web-legend/contracts';
import { describe, expect, it } from 'vitest';

import { compileMapSet, MapCompileError, type MapCompileOptions, type MapSource } from './compile';
import { verifyManifestChecksum } from './checksum';
import { createMapRuntime } from './runtime';

const root = resolve(import.meta.dirname, '../../..');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as unknown;
}

function source(name: string): MapSource {
  return {
    name: `content/maps/${name}.tmj`,
    data: readJson(`content/maps/${name}.tmj`),
  };
}

function options(): MapCompileOptions {
  const manifest = assetManifestSchema.parse(readJson('content/assets/manifest.json'));
  const terrain = manifest.tilesets.terrain;
  if (terrain === undefined) {
    throw new Error('missing terrain tileset');
  }
  const tileset: MapTileset = {
    id: terrain.id,
    image: terrain.image,
    tileWidth: terrain.tileWidth,
    tileHeight: terrain.tileHeight,
    columns: terrain.columns,
    tileCount: terrain.tileCount,
  };
  return { tileset, assetManifestVersion: manifest.version };
}

function allSources(): MapSource[] {
  return [source('starter_town'), source('starter_wilds'), source('ruined_fields')];
}

function mutableSource(name: string): { name: string; data: Record<string, unknown> } {
  return {
    name: `content/maps/${name}.tmj`,
    data: JSON.parse(readFileSync(resolve(root, `content/maps/${name}.tmj`), 'utf8')) as Record<
      string,
      unknown
    >,
  };
}

type MutableLayer = {
  name: string;
  type: string;
  data?: number[];
  objects?: {
    id: number;
    x: number;
    y: number;
    properties?: { name: string; type?: string; value: unknown }[];
  }[];
};

function layers(data: Record<string, unknown>): MutableLayer[] {
  return data['layers'] as MutableLayer[];
}

describe('Tiled map compilation', () => {
  it('compiles the real town, wilds and ruins sources with cross-map portals', () => {
    const compiled = compileMapSet(allSources(), options());

    expect(compiled.map((map) => map.mapId).sort()).toEqual([
      'ruined_fields',
      'starter_town',
      'starter_wilds',
    ]);
    const town = compiled.find((map) => map.mapId === 'starter_town');
    const wilds = compiled.find((map) => map.mapId === 'starter_wilds');
    const ruins = compiled.find((map) => map.mapId === 'ruined_fields');
    expect(town?.portals[0]?.targetMapId).toBe('starter_wilds');
    expect(wilds?.portals[0]?.targetMapId).toBe('starter_town');
    expect(town?.pvpMode).toBe('none');
    expect(wilds?.pvpMode).toBe('open');
    expect(ruins?.pvpMode).toBe('open');
    expect(town?.npcPoints).toHaveLength(2);
    expect(town?.monsterSpawns).toHaveLength(0);
    // The Tiled sources mark the portal-adjacent spawn point as the respawn.
    expect(wilds?.respawnPoint).toEqual({ x: 2, y: 16 });
    expect(ruins?.respawnPoint).toEqual({ x: 4, y: 18 });
    // 36 spawns stay inside the phase-8 load target of 20–40 per map.
    expect(wilds?.monsterSpawns).toHaveLength(36);
    expect(new Set(wilds?.monsterSpawns.map((spawn) => spawn.id)).size).toBe(36);
    expect(new Set(wilds?.monsterSpawns.map((spawn) => spawn.monsterId))).toEqual(
      new Set(['wild_slime', 'forest_wolf', 'venom_spider', 'stone_guard', 'alpha_wolf']),
    );
    expect(ruins?.monsterSpawns).toHaveLength(29);
    expect(new Set(ruins?.monsterSpawns.map((spawn) => spawn.id)).size).toBe(29);
    expect(new Set(ruins?.monsterSpawns.map((spawn) => spawn.monsterId))).toEqual(
      new Set(['skeleton_warrior', 'corrupt_warlock', 'ruin_gargoyle']),
    );
    expect(town?.portals.find((portal) => portal.targetMapId === 'ruined_fields')).toBeDefined();
    expect(ruins?.portals[0]?.targetMapId).toBe('starter_town');
    for (const map of compiled) {
      expect(verifyManifestChecksum(map)).toBe(true);
    }
  });

  it('keeps the checked-in compiled maps in sync with the Tiled sources', () => {
    const compiled = compileMapSet(allSources(), options());
    for (const map of compiled) {
      const checkedIn = readJson(`content/maps/compiled/${map.mapId}.json`);
      expect(checkedIn).toEqual(map);
    }
  });

  it('rejects a map without a collision layer', () => {
    const town = mutableSource('starter_town');
    town.data['layers'] = layers(town.data).filter((layer) => layer.name !== 'collision');

    expect(() => compileMapSet([town], options())).toThrow(MapCompileError);
  });

  it('rejects a spawn point on a blocked tile', () => {
    const town = mutableSource('starter_town');
    const spawns = layers(town.data).find((layer) => layer.name === 'spawn_points');
    if (spawns?.objects?.[0] === undefined) {
      throw new Error('town has no spawn point');
    }
    spawns.objects[0].x = 0 * 32 + 16;
    spawns.objects[0].y = 0 * 32 + 16;
    spawns.objects[0].properties = [
      { name: 'tileX', type: 'int', value: 0 },
      { name: 'tileY', type: 'int', value: 0 },
    ];

    expect(() => compileMapSet([town], options())).toThrow(
      /spawn point 0 tile \(0, 0\) is blocked/,
    );
  });

  it('honours a respawn marker, falls back to the first spawn and rejects two markers', () => {
    const wilds = mutableSource('starter_wilds');
    const objects = layers(wilds.data).find((layer) => layer.name === 'spawn_points')?.objects;
    const second = objects?.[1];
    const third = objects?.[2];
    if (objects === undefined || second === undefined || third === undefined) {
      throw new Error('wilds has too few spawn points');
    }

    for (const object of objects) {
      object.properties = (object.properties ?? []).filter(
        (property) => property.name !== 'respawn',
      );
    }

    const fallback = compileMapSet(
      [source('starter_town'), source('ruined_fields'), wilds],
      options(),
    ).find((map) => map.mapId === 'starter_wilds');
    expect(fallback?.respawnPoint).toEqual(fallback?.spawnPoints[0]);

    second.properties = [
      ...(second.properties ?? []),
      { name: 'respawn', type: 'bool', value: true },
    ];
    const marked = compileMapSet(
      [source('starter_town'), source('ruined_fields'), wilds],
      options(),
    ).find((map) => map.mapId === 'starter_wilds');
    expect(marked?.respawnPoint).toEqual({ x: 3, y: 16 });

    third.properties = [
      ...(third.properties ?? []),
      { name: 'respawn', type: 'bool', value: true },
    ];
    expect(() =>
      compileMapSet([source('starter_town'), source('ruined_fields'), wilds], options()),
    ).toThrow(/at most one respawn point/);
  });

  it('rejects a portal to an unknown map', () => {
    const town = mutableSource('starter_town');
    const portals = layers(town.data).find((layer) => layer.name === 'portals');
    const portal = portals?.objects?.[0];
    if (portal === undefined || portal.properties === undefined) {
      throw new Error('town has no portal');
    }
    portal.properties = portal.properties.map((property) =>
      property.name === 'targetMapId' ? { ...property, value: 'missing_map' } : property,
    );

    expect(() => compileMapSet([town], options())).toThrow(/unknown map "missing_map"/);
  });

  it('rejects a portal that cannot be reached from the spawn', () => {
    const town = mutableSource('starter_town');
    const collision = layers(town.data).find((layer) => layer.name === 'collision');
    if (collision?.data === undefined) {
      throw new Error('town has no collision data');
    }
    const width = 40;
    for (const [x, y] of [
      [37, 15],
      [38, 14],
      [38, 16],
    ] as const) {
      collision.data[y * width + x] = 1;
    }

    expect(() => compileMapSet([town], options())).toThrow(/not reachable/);
  });

  it('rejects an NPC id the shop protocol cannot address', () => {
    const town = mutableSource('starter_town');
    const npcs = layers(town.data).find((layer) => layer.name === 'npc_points');
    const merchant = npcs?.objects?.[0];
    if (merchant?.properties === undefined) {
      throw new Error('town has no NPC');
    }
    merchant.properties = merchant.properties.map((property) =>
      property.name === 'npcId' ? { ...property, value: 'Town Merchant' } : property,
    );

    expect(() => compileMapSet([town], options())).toThrow(/invalid npcId/);
  });

  it('rejects duplicate map ids', () => {
    expect(() =>
      compileMapSet([source('starter_town'), source('starter_town')], options()),
    ).toThrow(/already declared|duplicate mapId/);
  });
});

describe('compiled map runtime', () => {
  const compiled = compileMapSet(allSources(), options());
  const town = compiled.find((map) => map.mapId === 'starter_town');
  if (town === undefined) {
    throw new Error('town did not compile');
  }

  it('exposes walkability, tile conversion and portals', () => {
    const runtime = createMapRuntime(town);

    expect(runtime.isWalkable(18, 10)).toBe(true);
    expect(runtime.isWalkable(0, 0)).toBe(false);
    expect(runtime.tileOfUnits(18_500, 10_500)).toEqual({ x: 18, y: 10 });
    expect(runtime.portalAt({ x: 38, y: 15 })?.targetMapId).toBe('starter_wilds');
    expect(runtime.portalAt({ x: 18, y: 10 })).toBeUndefined();
    expect(runtime.grid.width).toBe(town.width);
  });

  it('refuses a manifest whose content no longer matches its checksum', () => {
    const tampered = {
      ...town,
      layers: { ...town.layers, ground: [...town.layers.ground] },
    };
    tampered.layers.ground[0] = 8;

    expect(() => createMapRuntime(tampered)).toThrow(/checksum/);
  });
});
