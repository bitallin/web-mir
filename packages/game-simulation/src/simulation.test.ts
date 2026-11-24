import { mapManifestSchema, TILE_UNITS } from '@web-legend/contracts';
import { describe, expect, it } from 'vitest';

import rawTestMap from '../../../content/maps/phase1_test_map.json';
import { gridFromManifest, type MovementGrid } from './grid';
import { findPath } from './pathfinding';
import { tileCenter, tileOfUnits, WorldSimulation } from './simulation';

function openGrid(): MovementGrid {
  const rows = ['##########', '#........#', '#........#', '#........#', '##########'];
  return {
    width: 10,
    height: 5,
    isWalkable: (x, y) => rows[y]?.[x] === '.',
  };
}

function advance(simulation: WorldSimulation, steps: number, stepMs = 50): void {
  for (let index = 0; index < steps; index += 1) {
    simulation.step(stepMs);
  }
}

describe('WorldSimulation', () => {
  it('places a player at the spawn tile center', () => {
    const simulation = new WorldSimulation(openGrid());
    const player = simulation.addPlayer({
      id: 'p1',
      displayName: 'Alice',
      spawn: { x: 1, y: 1 },
      colorIndex: 0,
    });

    expect(player.x).toBe(1 * TILE_UNITS + TILE_UNITS / 2);
    expect(player.y).toBe(1 * TILE_UNITS + TILE_UNITS / 2);
    expect(player.moving).toBe(false);
  });

  it('moves at the configured speed and stops exactly at the target', () => {
    const simulation = new WorldSimulation(openGrid());
    simulation.addPlayer({ id: 'p1', displayName: 'Alice', spawn: { x: 1, y: 1 }, colorIndex: 0 });
    simulation.setPath('p1', findPath(openGrid(), { x: 1, y: 1 }, { x: 5, y: 1 }) ?? []);

    advance(simulation, 10);
    expect(simulation.getPlayer('p1')?.x).toBe(1 * TILE_UNITS + 2_500);

    advance(simulation, 10);
    const player = simulation.getPlayer('p1');
    expect(player?.x).toBe(5 * TILE_UNITS + TILE_UNITS / 2);
    expect(player?.y).toBe(1 * TILE_UNITS + TILE_UNITS / 2);
    expect(player?.moving).toBe(false);
    expect(player?.facing).toBe(1);

    advance(simulation, 5);
    expect(simulation.getPlayer('p1')?.x).toBe(5 * TILE_UNITS + TILE_UNITS / 2);
  });

  it('respects a slower speed over the same path', () => {
    const simulation = new WorldSimulation(openGrid());
    simulation.addPlayer({
      id: 'p1',
      displayName: 'Alice',
      spawn: { x: 1, y: 1 },
      colorIndex: 0,
      speedUnitsPerSecond: 2_000,
    });
    simulation.setPath('p1', findPath(openGrid(), { x: 1, y: 1 }, { x: 5, y: 1 }) ?? []);

    advance(simulation, 20);
    expect(simulation.getPlayer('p1')?.x).toBe(3 * TILE_UNITS + TILE_UNITS / 2);
    expect(simulation.getPlayer('p1')?.moving).toBe(true);
  });

  it('never enters a blocked tile while following a detour', () => {
    const map = mapManifestSchema.parse(rawTestMap);
    const grid = gridFromManifest(map);
    const simulation = new WorldSimulation(grid);
    simulation.addPlayer({ id: 'p1', displayName: 'Alice', spawn: { x: 2, y: 10 }, colorIndex: 0 });

    const path = findPath(grid, { x: 2, y: 10 }, { x: 14, y: 10 });
    expect(path).not.toBeNull();
    simulation.setPath('p1', path ?? []);

    for (let index = 0; index < 200; index += 1) {
      simulation.step(50);
      const player = simulation.getPlayer('p1');
      if (player === undefined) {
        break;
      }
      const tile = tileOfUnits(player);
      expect(grid.isWalkable(tile.x, tile.y)).toBe(true);
    }

    expect(tileOfUnits(simulation.getPlayer('p1') ?? { x: 0, y: 0 })).toEqual({ x: 14, y: 10 });
  });

  it('prepends the current tile center when retargeted mid-tile and stays axis-aligned', () => {
    const grid = openGrid();
    const simulation = new WorldSimulation(grid);
    simulation.addPlayer({ id: 'p1', displayName: 'Alice', spawn: { x: 1, y: 1 }, colorIndex: 0 });
    simulation.setPath('p1', findPath(grid, { x: 1, y: 1 }, { x: 6, y: 1 }) ?? []);

    advance(simulation, 7);
    const before = simulation.getPlayer('p1');
    expect(before?.x).toBe(2_900);

    simulation.setPath('p1', findPath(grid, { x: 2, y: 1 }, { x: 1, y: 3 }) ?? []);

    for (let index = 0; index < 100; index += 1) {
      simulation.step(50);
      const player = simulation.getPlayer('p1');
      if (player === undefined) {
        break;
      }
      const tile = tileOfUnits(player);
      expect(grid.isWalkable(tile.x, tile.y)).toBe(true);
    }

    expect(tileOfUnits(simulation.getPlayer('p1') ?? { x: 0, y: 0 })).toEqual({ x: 1, y: 3 });
  });

  it('is deterministic for the same inputs', () => {
    const run = (): { x: number; y: number } => {
      const grid = openGrid();
      const simulation = new WorldSimulation(grid);
      simulation.addPlayer({
        id: 'p1',
        displayName: 'Alice',
        spawn: { x: 1, y: 1 },
        colorIndex: 0,
      });
      simulation.setPath('p1', findPath(grid, { x: 1, y: 1 }, { x: 4, y: 3 }) ?? []);
      advance(simulation, 17);
      const player = simulation.getPlayer('p1');
      return { x: player?.x ?? 0, y: player?.y ?? 0 };
    };

    expect(run()).toEqual(run());
  });

  it('stops when the path is cleared and rejects invalid spawns', () => {
    const simulation = new WorldSimulation(openGrid());
    expect(() =>
      simulation.addPlayer({
        id: 'p1',
        displayName: 'Alice',
        spawn: { x: 0, y: 0 },
        colorIndex: 0,
      }),
    ).toThrow(RangeError);

    simulation.addPlayer({ id: 'p1', displayName: 'Alice', spawn: { x: 1, y: 1 }, colorIndex: 0 });
    simulation.setPath('p1', findPath(openGrid(), { x: 1, y: 1 }, { x: 5, y: 1 }) ?? []);

    advance(simulation, 3);
    const stoppedAt = simulation.getPlayer('p1')?.x;
    simulation.clearPath('p1');
    advance(simulation, 3);

    expect(simulation.getPlayer('p1')?.x).toBe(stoppedAt);
    expect(simulation.getPlayer('p1')?.moving).toBe(false);
  });

  it('rejects duplicate players and removes cleanly', () => {
    const simulation = new WorldSimulation(openGrid());
    simulation.addPlayer({ id: 'p1', displayName: 'Alice', spawn: { x: 1, y: 1 }, colorIndex: 0 });

    expect(() =>
      simulation.addPlayer({ id: 'p1', displayName: 'Bob', spawn: { x: 2, y: 1 }, colorIndex: 1 }),
    ).toThrow(Error);

    expect(simulation.removePlayer('p1')).toBe(true);
    expect(simulation.removePlayer('p1')).toBe(false);
    expect(simulation.listPlayers()).toHaveLength(0);
  });
});

describe('phase 1 test map reachability', () => {
  it('exposes the sealed chamber as unreachable from the spawn area', () => {
    const grid = gridFromManifest(mapManifestSchema.parse(rawTestMap));
    expect(findPath(grid, { x: 15, y: 10 }, { x: 23, y: 5 })).toBeNull();
    expect(findPath(grid, { x: 15, y: 10 }, { x: 2, y: 16 })).not.toBeNull();
    expect(tileCenter({ x: 2, y: 16 })).toEqual({ x: 2_500, y: 16_500 });
  });
});
