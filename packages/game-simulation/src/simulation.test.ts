import { TILE_UNITS } from '@web-legend/contracts';
import { describe, expect, it } from 'vitest';

import type { MovementGrid } from './grid';
import { findPath } from './pathfinding';
import { tileCenter, tileOfUnits, WorldSimulation } from './simulation';

function gridFromRows(rows: readonly string[]): MovementGrid {
  return {
    width: rows[0]?.length ?? 0,
    height: rows.length,
    isWalkable: (x, y) => rows[y]?.[x] === '.',
  };
}

function openGrid(): MovementGrid {
  return gridFromRows(['##########', '#........#', '#........#', '#........#', '##########']);
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

  it('restores an exact persisted position and facing', () => {
    const simulation = new WorldSimulation(openGrid());
    const player = simulation.addPlayer({
      id: 'p1',
      displayName: 'Alice',
      spawn: { x: 1, y: 1 },
      colorIndex: 0,
      position: { x: 3_700, y: 2_300 },
      facing: 1,
    });

    expect(player.x).toBe(3_700);
    expect(player.y).toBe(2_300);
    expect(player.facing).toBe(1);
    expect(tileOfUnits(player)).toEqual({ x: 3, y: 2 });
  });

  it('rejects a restored position that is not on a walkable tile', () => {
    const simulation = new WorldSimulation(openGrid());

    expect(() =>
      simulation.addPlayer({
        id: 'p1',
        displayName: 'Alice',
        spawn: { x: 1, y: 1 },
        colorIndex: 0,
        position: { x: -100, y: 1_500 },
      }),
    ).toThrow(RangeError);

    expect(() =>
      simulation.addPlayer({
        id: 'p2',
        displayName: 'Bob',
        spawn: { x: 1, y: 1 },
        colorIndex: 0,
        position: { x: 500, y: 500 },
      }),
    ).toThrow(/not walkable/u);

    expect(() =>
      simulation.addPlayer({
        id: 'p3',
        displayName: 'Cara',
        spawn: { x: 1, y: 1 },
        colorIndex: 0,
        position: { x: 1_500.5, y: 1_500 },
      }),
    ).toThrow(RangeError);
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
    const grid = gridFromRows([
      '###############',
      '#.............#',
      '#.#####.#####.#',
      '#.............#',
      '###############',
    ]);
    const simulation = new WorldSimulation(grid);
    simulation.addPlayer({ id: 'p1', displayName: 'Alice', spawn: { x: 2, y: 1 }, colorIndex: 0 });

    const path = findPath(grid, { x: 2, y: 1 }, { x: 13, y: 1 });
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

    expect(tileOfUnits(simulation.getPlayer('p1') ?? { x: 0, y: 0 })).toEqual({ x: 13, y: 1 });
  });

  it('retargets mid-tile through a detour without entering blocked tiles', () => {
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

  it('keeps walking forward when a new path continues the same direction', () => {
    const grid = openGrid();
    const simulation = new WorldSimulation(grid);
    simulation.addPlayer({ id: 'p1', displayName: 'Alice', spawn: { x: 1, y: 1 }, colorIndex: 0 });
    simulation.setPath('p1', findPath(grid, { x: 1, y: 1 }, { x: 6, y: 1 }) ?? []);

    // 350ms at 4 tiles/s leaves the player 400 units past tile 2's center.
    advance(simulation, 7);
    expect(simulation.getPlayer('p1')?.x).toBe(2_900);

    simulation.setPath('p1', findPath(grid, { x: 2, y: 1 }, { x: 6, y: 1 }) ?? []);
    advance(simulation, 1);

    expect(simulation.getPlayer('p1')?.x).toBe(3_100);
    expect(simulation.getPlayer('p1')?.y).toBe(1 * TILE_UNITS + TILE_UNITS / 2);
  });

  it('walks straight to the next tile center on a perpendicular retarget', () => {
    const grid = openGrid();
    const simulation = new WorldSimulation(grid);
    simulation.addPlayer({ id: 'p1', displayName: 'Alice', spawn: { x: 1, y: 1 }, colorIndex: 0 });
    simulation.setPath('p1', findPath(grid, { x: 1, y: 1 }, { x: 6, y: 1 }) ?? []);

    // 350ms east leaves the player 400 units past tile 2's center.
    advance(simulation, 7);
    expect(simulation.getPlayer('p1')?.x).toBe(2_900);

    simulation.setPath('p1', findPath(grid, { x: 2, y: 1 }, { x: 2, y: 3 }) ?? []);
    advance(simulation, 1);

    // The path heads to (2.5, 2.5); the step is diagonal (not axis-aligned)
    // and never returns to (2.5, 1.5) first.
    expect(simulation.getPlayer('p1')?.x).toBe(2_826);
    expect(simulation.getPlayer('p1')?.y).toBe(1_686);
    expect(simulation.getPlayer('p1')?.facing).toBe(6);
  });

  it('never retreats when the same path is re-applied every repath interval', () => {
    const grid = openGrid();
    const simulation = new WorldSimulation(grid);
    simulation.addPlayer({ id: 'p1', displayName: 'Alice', spawn: { x: 1, y: 1 }, colorIndex: 0 });
    simulation.setPath('p1', findPath(grid, { x: 1, y: 1 }, { x: 6, y: 1 }) ?? []);

    let last = simulation.getPlayer('p1')?.x ?? 0;
    for (let interval = 0; interval < 5; interval += 1) {
      advance(simulation, 7);
      const current = simulation.getPlayer('p1');
      expect(current?.x).toBeGreaterThanOrEqual(last);
      last = current?.x ?? last;
      const tile = current === undefined ? { x: 1, y: 1 } : tileOfUnits(current);
      simulation.setPath('p1', findPath(grid, tile, { x: 6, y: 1 }) ?? []);
    }
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

describe('sealed map areas', () => {
  it('keeps an enclosed chamber unreachable from the open area', () => {
    const grid = gridFromRows([
      '#########',
      '#.......#',
      '#.#####.#',
      '#.#...#.#',
      '#.#####.#',
      '#.......#',
      '#########',
    ]);
    expect(findPath(grid, { x: 2, y: 1 }, { x: 4, y: 3 })).toBeNull();
    expect(findPath(grid, { x: 2, y: 1 }, { x: 6, y: 5 })).not.toBeNull();
    expect(tileCenter({ x: 2, y: 16 })).toEqual({ x: 2_500, y: 16_500 });
  });
});
