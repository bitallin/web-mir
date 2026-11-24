import {
  MAP_RUNTIME_SCHEMA_VERSION,
  mapRuntimeManifestSchema,
  type MapMonsterSpawn,
  type MapNpcPoint,
  type MapPortal,
  type MapRuntimeManifest,
  type MapTileset,
  type TilePoint,
} from '@web-legend/contracts';

import { mapChecksum, type ManifestFingerprint } from './checksum';
import {
  tiledIntegerProperty,
  tiledMapSchema,
  tiledStringProperty,
  type TiledMap,
  type TiledObject,
  type TiledObjectLayer,
  type TiledTileLayer,
} from './tiled';

export class MapCompileError extends Error {
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(`${source}: ${message}`);
    this.name = 'MapCompileError';
  }
}

export type MapCompileOptions = {
  tileset: MapTileset;
  assetManifestVersion: string;
};

export type MapSource = {
  /** Used in error messages, usually the .tmj file name. */
  name: string;
  data: unknown;
};

function requiredLayer<T extends TiledTileLayer | TiledObjectLayer>(
  map: TiledMap,
  source: string,
  name: string,
  type: T['type'],
): T {
  const layer = map.layers.find((candidate) => candidate.name === name);
  if (layer === undefined) {
    throw new MapCompileError(source, `missing required layer "${name}"`);
  }
  if (layer.type !== type) {
    throw new MapCompileError(source, `layer "${name}" must be a ${type}`);
  }
  return layer as T;
}

function optionalTileLayer(map: TiledMap, name: string): TiledTileLayer | undefined {
  const layer = map.layers.find((candidate) => candidate.name === name);
  return layer?.type === 'tilelayer' ? layer : undefined;
}

function optionalObjectLayer(map: TiledMap, name: string): TiledObjectLayer | undefined {
  const layer = map.layers.find((candidate) => candidate.name === name);
  return layer?.type === 'objectgroup' ? layer : undefined;
}

function mapProperty(map: TiledMap, name: string): unknown {
  return map.properties?.find((property) => property.name === name)?.value;
}

function objectTile(map: TiledMap, source: string, object: TiledObject): TilePoint {
  const explicitX = tiledIntegerProperty(object, 'tileX');
  const explicitY = tiledIntegerProperty(object, 'tileY');
  const derived: TilePoint = {
    x: Math.floor(object.x / map.tilewidth),
    y: Math.floor(object.y / map.tileheight),
  };
  if (explicitX !== undefined && explicitY !== undefined) {
    if (Math.abs(explicitX - derived.x) > 1 || Math.abs(explicitY - derived.y) > 1) {
      throw new MapCompileError(
        source,
        `object ${String(object.id)} tile properties disagree with its pixel position`,
      );
    }
    return { x: explicitX, y: explicitY };
  }
  return derived;
}

function tileKey(point: TilePoint): string {
  return `${String(point.x)}:${String(point.y)}`;
}

function assertWalkable(
  source: string,
  map: { width: number; height: number },
  collision: readonly number[],
  point: TilePoint,
  description: string,
): void {
  if (
    !Number.isInteger(point.x) ||
    !Number.isInteger(point.y) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x >= map.width ||
    point.y >= map.height
  ) {
    throw new MapCompileError(
      source,
      `${description} tile (${String(point.x)}, ${String(point.y)}) is outside the map`,
    );
  }
  if (collision[point.y * map.width + point.x] !== 0) {
    throw new MapCompileError(
      source,
      `${description} tile (${String(point.x)}, ${String(point.y)}) is blocked`,
    );
  }
}

function compileSingle(source: MapSource, options: MapCompileOptions): MapRuntimeManifest {
  const parsed = tiledMapSchema.safeParse(source.data);
  if (!parsed.success) {
    throw new MapCompileError(source.name, parsed.error.issues[0]?.message ?? 'invalid Tiled map');
  }
  const map = parsed.data;

  if (map.tilewidth !== map.tileheight) {
    throw new MapCompileError(source.name, 'logical map tiles must be square');
  }
  if (map.tilesets.length !== 1) {
    throw new MapCompileError(source.name, 'expected exactly one tileset');
  }
  const tileset = map.tilesets[0];
  if (tileset === undefined) {
    throw new MapCompileError(source.name, 'missing tileset');
  }
  if (tileset.firstgid !== 1) {
    throw new MapCompileError(source.name, 'tileset firstgid must be 1');
  }
  if (tileset.tilecount > options.tileset.tileCount) {
    throw new MapCompileError(
      source.name,
      `map uses tile ${String(tileset.tilecount)} but the asset manifest declares ${String(options.tileset.tileCount)}`,
    );
  }

  const mapId = mapProperty(map, 'mapId');
  const mapName = mapProperty(map, 'name');
  const kind = mapProperty(map, 'kind');
  if (typeof mapId !== 'string') {
    throw new MapCompileError(source.name, 'map property "mapId" is required');
  }
  if (typeof mapName !== 'string') {
    throw new MapCompileError(source.name, 'map property "name" is required');
  }
  if (kind !== 'town' && kind !== 'wilds') {
    throw new MapCompileError(source.name, 'map property "kind" must be "town" or "wilds"');
  }

  const cellCount = map.width * map.height;
  const ground = requiredLayer<TiledTileLayer>(map, source.name, 'ground', 'tilelayer');
  const collisionLayer = requiredLayer<TiledTileLayer>(map, source.name, 'collision', 'tilelayer');
  const spawnLayer = requiredLayer<TiledObjectLayer>(
    map,
    source.name,
    'spawn_points',
    'objectgroup',
  );

  for (const layer of [ground, collisionLayer]) {
    if (layer.width !== map.width || layer.height !== map.height) {
      throw new MapCompileError(source.name, `layer "${layer.name}" must cover the whole map`);
    }
    if (layer.data.length !== cellCount) {
      throw new MapCompileError(
        source.name,
        `layer "${layer.name}" has ${String(layer.data.length)} cells, expected ${String(cellCount)}`,
      );
    }
  }

  const collision = collisionLayer.data.map((value, index) => {
    if (value !== 0 && value !== 1) {
      throw new MapCompileError(
        source.name,
        `collision layer cell ${String(index)} must be 0 or 1, received ${String(value)}`,
      );
    }
    return value;
  });

  for (const [index, gid] of ground.data.entries()) {
    if (gid < 1 || gid > options.tileset.tileCount) {
      throw new MapCompileError(
        source.name,
        `ground cell ${String(index)} uses tile ${String(gid)} outside the tileset`,
      );
    }
  }

  const decoLow = optionalTileLayer(map, 'deco_low')?.data ?? new Array<number>(cellCount).fill(0);
  const decoHigh =
    optionalTileLayer(map, 'deco_high')?.data ?? new Array<number>(cellCount).fill(0);
  for (const layer of [
    ['deco_low', decoLow],
    ['deco_high', decoHigh],
  ] as const) {
    if (layer[1].length !== cellCount) {
      throw new MapCompileError(source.name, `layer "${layer[0]}" must cover the whole map`);
    }
  }

  if (spawnLayer.objects.length === 0) {
    throw new MapCompileError(source.name, 'spawn_points must contain at least one point');
  }
  const spawnPoints = spawnLayer.objects.map((object) => objectTile(map, source.name, object));

  const portalLayer = optionalObjectLayer(map, 'portals');
  const portals: MapPortal[] = (portalLayer?.objects ?? []).map((object) => {
    const id = tiledStringProperty(object, 'portalId');
    const label = tiledStringProperty(object, 'label');
    const targetMapId = tiledStringProperty(object, 'targetMapId');
    const targetX = tiledIntegerProperty(object, 'targetTileX');
    const targetY = tiledIntegerProperty(object, 'targetTileY');
    if (
      id === undefined ||
      label === undefined ||
      targetMapId === undefined ||
      targetX === undefined ||
      targetY === undefined
    ) {
      throw new MapCompileError(
        source.name,
        `portal object ${String(object.id)} needs portalId, label, targetMapId, targetTileX and targetTileY`,
      );
    }
    return {
      id,
      label,
      tile: objectTile(map, source.name, object),
      targetMapId,
      targetTile: { x: targetX, y: targetY },
    };
  });

  const npcPoints: MapNpcPoint[] = (optionalObjectLayer(map, 'npc_points')?.objects ?? []).map(
    (object) => {
      const id = tiledStringProperty(object, 'npcId');
      const name = tiledStringProperty(object, 'npcName');
      if (id === undefined || name === undefined) {
        throw new MapCompileError(
          source.name,
          `NPC object ${String(object.id)} needs npcId and npcName`,
        );
      }
      return { id, name, tile: objectTile(map, source.name, object) };
    },
  );

  const monsterSpawns: MapMonsterSpawn[] = (
    optionalObjectLayer(map, 'monster_spawns')?.objects ?? []
  ).map((object) => {
    const id = tiledStringProperty(object, 'spawnId');
    const monsterId = tiledStringProperty(object, 'monsterId');
    if (id === undefined || monsterId === undefined) {
      throw new MapCompileError(
        source.name,
        `monster spawn ${String(object.id)} needs spawnId and monsterId`,
      );
    }
    return { id, monsterId, tile: objectTile(map, source.name, object) };
  });

  spawnPoints.forEach((point, index) => {
    assertWalkable(source.name, map, collision, point, `spawn point ${String(index)}`);
  });
  portals.forEach((portal, index) => {
    assertWalkable(source.name, map, collision, portal.tile, `portal ${String(index)}`);
  });
  npcPoints.forEach((npc, index) => {
    assertWalkable(source.name, map, collision, npc.tile, `NPC ${String(index)}`);
  });
  monsterSpawns.forEach((spawn, index) => {
    assertWalkable(source.name, map, collision, spawn.tile, `monster spawn ${String(index)}`);
  });

  const portalIds = new Set<string>();
  for (const portal of portals) {
    if (portalIds.has(portal.id)) {
      throw new MapCompileError(source.name, `duplicate portal id "${portal.id}"`);
    }
    portalIds.add(portal.id);
  }

  const fingerprint: ManifestFingerprint = {
    schemaVersion: MAP_RUNTIME_SCHEMA_VERSION,
    mapId,
    name: mapName,
    kind,
    width: map.width,
    height: map.height,
    tileWidth: map.tilewidth,
    tileHeight: map.tileheight,
    tileset: options.tileset,
    layers: {
      ground: ground.data,
      decoLow,
      decoHigh,
      collision,
    },
    spawnPoints,
    portals,
    npcPoints,
    monsterSpawns,
    assetManifestVersion: options.assetManifestVersion,
  };

  const manifest: MapRuntimeManifest = { ...fingerprint, checksum: mapChecksum(fingerprint) };
  return mapRuntimeManifestSchema.parse(manifest);
}

function reachableTiles(map: MapRuntimeManifest, start: TilePoint): Set<string> {
  const reachable = new Set<string>();
  const width = map.width;
  const isWalkable = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < map.height && map.layers.collision[y * width + x] === 0;

  const queue: TilePoint[] = [start];
  const first = tileKey(start);
  reachable.add(first);

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === undefined) {
      break;
    }
    for (const offset of [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ]) {
      const next = { x: current.x + offset.x, y: current.y + offset.y };
      const key = tileKey(next);
      if (reachable.has(key) || !isWalkable(next.x, next.y)) {
        continue;
      }
      reachable.add(key);
      queue.push(next);
    }
  }
  return reachable;
}

/**
 * Compiles a set of source maps and validates cross-map references and
 * reachability. Both maps must be supplied together: a portal target is only
 * accepted when the target map exists and the target tile is walkable.
 */
export function compileMapSet(
  sources: readonly MapSource[],
  options: MapCompileOptions,
): MapRuntimeManifest[] {
  const manifests = sources.map((source) => compileSingle(source, options));
  const byId = new Map<string, MapRuntimeManifest>();

  for (const manifest of manifests) {
    if (byId.has(manifest.mapId)) {
      throw new MapCompileError(manifest.mapId, 'duplicate mapId');
    }
    byId.set(manifest.mapId, manifest);

    const reachable = reachableTiles(manifest, manifest.spawnPoints[0] ?? { x: 0, y: 0 });
    for (const portal of manifest.portals) {
      if (!reachable.has(tileKey(portal.tile))) {
        throw new MapCompileError(
          manifest.mapId,
          `portal "${portal.id}" is not reachable from the first spawn point`,
        );
      }
    }
  }

  for (const manifest of manifests) {
    for (const portal of manifest.portals) {
      const target = byId.get(portal.targetMapId);
      if (target === undefined) {
        throw new MapCompileError(
          manifest.mapId,
          `portal "${portal.id}" targets unknown map "${portal.targetMapId}"`,
        );
      }
      assertWalkable(
        manifest.mapId,
        target,
        target.layers.collision,
        portal.targetTile,
        `portal "${portal.id}" target`,
      );
    }
  }

  return manifests;
}
