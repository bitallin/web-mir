import { describe, expect, it } from 'vitest';

import {
  MAP_MANIFESTS,
  RUINED_FIELDS_MAP_ID,
  STARTER_TOWN_MAP,
  STARTER_TOWN_MAP_ID,
  STARTER_WILDS_MAP,
  STARTER_WILDS_MAP_ID,
} from '@web-legend/contracts/maps';
import { createMapRuntime } from '@web-legend/map-runtime';

import {
  findNpcApproachPath,
  mapsWithMonsterSpawns,
  mapsWithNpc,
  nearestSpawnTile,
  nextPortalToward,
} from '../src/world/questRouting';

describe('quest routing', () => {
  it('finds the maps that spawn a monster or place a giver', () => {
    expect(mapsWithMonsterSpawns(MAP_MANIFESTS, 'wild_slime')).toEqual([STARTER_WILDS_MAP_ID]);
    expect(mapsWithMonsterSpawns(MAP_MANIFESTS, 'missing_monster')).toEqual([]);
    expect(mapsWithNpc(MAP_MANIFESTS, 'town_guard')).toEqual([STARTER_TOWN_MAP_ID]);
    expect(mapsWithNpc(MAP_MANIFESTS, 'missing_npc')).toEqual([]);
  });

  it('returns the first portal on a direct route', () => {
    expect(
      nextPortalToward(MAP_MANIFESTS, STARTER_TOWN_MAP_ID, new Set([STARTER_WILDS_MAP_ID])),
    ).toMatchObject({
      mapId: STARTER_WILDS_MAP_ID,
      portalTile: { x: 38, y: 15 },
    });
    expect(
      nextPortalToward(MAP_MANIFESTS, STARTER_WILDS_MAP_ID, new Set([STARTER_TOWN_MAP_ID])),
    ).toMatchObject({
      mapId: STARTER_TOWN_MAP_ID,
      portalTile: { x: 1, y: 16 },
    });
  });

  it('routes through the town hub when no direct portal exists', () => {
    expect(
      nextPortalToward(MAP_MANIFESTS, STARTER_WILDS_MAP_ID, new Set([RUINED_FIELDS_MAP_ID])),
    ).toMatchObject({
      mapId: STARTER_TOWN_MAP_ID,
      portalTile: { x: 1, y: 16 },
    });
  });

  it('needs no portal when already on the target map or when none exists', () => {
    expect(
      nextPortalToward(MAP_MANIFESTS, STARTER_TOWN_MAP_ID, new Set([STARTER_TOWN_MAP_ID])),
    ).toBe(null);
    expect(nextPortalToward(MAP_MANIFESTS, STARTER_TOWN_MAP_ID, new Set(['missing_map']))).toBe(
      null,
    );
  });

  it('picks the closest spawn of the requested monster', () => {
    const from = { x: 2, y: 16 };
    const tile = nearestSpawnTile(STARTER_WILDS_MAP, 'wild_slime', from);
    expect(tile).not.toBeNull();
    const slimeSpawns = STARTER_WILDS_MAP.monsterSpawns.filter(
      (spawn) => spawn.monsterId === 'wild_slime',
    );
    const expected = Math.min(
      ...slimeSpawns.map((spawn) => (spawn.tile.x - from.x) ** 2 + (spawn.tile.y - from.y) ** 2),
    );
    expect(((tile?.x ?? 0) - from.x) ** 2 + ((tile?.y ?? 0) - from.y) ** 2).toBe(expected);
    expect(nearestSpawnTile(STARTER_WILDS_MAP, 'missing_monster', from)).toBeNull();
  });

  it('finds a reachable walkable tile within range of the giver', () => {
    const runtime = createMapRuntime(STARTER_TOWN_MAP);
    const guard = STARTER_TOWN_MAP.npcPoints.find((npc) => npc.id === 'town_guard');
    expect(guard).toBeDefined();
    if (guard === undefined) {
      return;
    }
    const path = findNpcApproachPath(runtime, guard.tile, { x: 10, y: 10 }, 3);
    expect(path).not.toBeNull();
    if (path === null) {
      return;
    }
    const end = path[path.length - 1] ?? { x: 10, y: 10 };
    expect(Math.hypot(end.x - guard.tile.x, end.y - guard.tile.y)).toBeLessThanOrEqual(3);
    for (const tile of path) {
      expect(runtime.isWalkable(tile.x, tile.y)).toBe(true);
    }
  });
});
