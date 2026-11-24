import { describe, expect, it } from 'vitest';

import rawTestMap from '../../../content/maps/phase1_test_map.json';
import { isTileInsideMap, isTileWalkable, mapManifestSchema } from './map';

function rows(height: number, width: number): string[] {
  return Array.from({ length: height }, () => '.'.repeat(width));
}

describe('mapManifestSchema', () => {
  it('accepts the phase 1 technical map', () => {
    const map = mapManifestSchema.parse(rawTestMap);

    expect(map.id).toBe('phase1_test_map');
    expect(map.tiles).toHaveLength(map.height);
    expect(map.spawnPoints.length).toBeGreaterThan(0);
  });

  it('accepts a hand-built valid map', () => {
    const map = mapManifestSchema.parse({
      schemaVersion: 1,
      id: 'demo_map',
      name: 'Demo',
      width: 5,
      height: 4,
      tiles: rows(4, 5),
      spawnPoints: [{ x: 1, y: 1 }],
    });

    expect(map.width).toBe(5);
  });

  it('rejects a row with the wrong column count', () => {
    const result = mapManifestSchema.safeParse({
      schemaVersion: 1,
      id: 'demo_map',
      name: 'Demo',
      width: 5,
      height: 2,
      tiles: ['.....', '....'],
      spawnPoints: [{ x: 1, y: 1 }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects unknown tile characters', () => {
    const result = mapManifestSchema.safeParse({
      schemaVersion: 1,
      id: 'demo_map',
      name: 'Demo',
      width: 5,
      height: 1,
      tiles: ['..x..'],
      spawnPoints: [{ x: 1, y: 0 }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects spawn points on walls or outside the map', () => {
    expect(
      mapManifestSchema.safeParse({
        schemaVersion: 1,
        id: 'demo_map',
        name: 'Demo',
        width: 3,
        height: 1,
        tiles: ['.#.'],
        spawnPoints: [{ x: 1, y: 0 }],
      }).success,
    ).toBe(false);

    expect(
      mapManifestSchema.safeParse({
        schemaVersion: 1,
        id: 'demo_map',
        name: 'Demo',
        width: 3,
        height: 1,
        tiles: ['...'],
        spawnPoints: [{ x: 3, y: 0 }],
      }).success,
    ).toBe(false);
  });
});

describe('walkability helpers', () => {
  const map = mapManifestSchema.parse(rawTestMap);

  it('treats the border as blocked and the interior floor as walkable', () => {
    expect(isTileWalkable(map, 0, 0)).toBe(false);
    expect(isTileWalkable(map, 15, 10)).toBe(true);
    expect(isTileWalkable(map, -1, 10)).toBe(false);
    expect(isTileWalkable(map, 10, 10)).toBe(false);
  });

  it('checks map bounds', () => {
    expect(isTileInsideMap(map, 29, 19)).toBe(true);
    expect(isTileInsideMap(map, 30, 19)).toBe(false);
    expect(isTileInsideMap(map, 1.5, 1)).toBe(false);
  });
});
