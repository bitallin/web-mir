import { describe, expect, it } from 'vitest';

import type { MovementGrid } from './grid';
import { findPath } from './pathfinding';

function grid(rows: string[]): MovementGrid {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  return {
    width,
    height,
    isWalkable: (x, y) => rows[y]?.[x] !== undefined && rows[y]?.[x] !== '#',
  };
}

const OPEN = grid(['.......', '.......', '.......', '.......', '.......']);

describe('findPath', () => {
  it('returns an empty path when already at the target', () => {
    expect(findPath(OPEN, { x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([]);
  });

  it('finds a straight four-directional path', () => {
    const path = findPath(OPEN, { x: 1, y: 1 }, { x: 4, y: 1 });

    expect(path).toEqual([
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
    ]);
  });

  it('routes around a wall without entering blocked tiles', () => {
    const map = grid(['.......', '...#...', '...#...', '.......']);
    const path = findPath(map, { x: 1, y: 1 }, { x: 5, y: 1 });

    expect(path).not.toBeNull();
    expect(path?.at(-1)).toEqual({ x: 5, y: 1 });
    for (const node of path ?? []) {
      expect(map.isWalkable(node.x, node.y)).toBe(true);
      expect(node).not.toEqual({ x: 3, y: 1 });
    }
    expect(path?.length).toBeGreaterThan(4);
  });

  it('returns null for a sealed area and for invalid targets', () => {
    const map = grid(['#####', '#.#.#', '#.#.#', '#####']);
    expect(findPath(map, { x: 2, y: 1 }, { x: 2, y: 2 })).toBeNull();
    expect(findPath(map, { x: 1, y: 1 }, { x: 3, y: 1 })).toBeNull();
    expect(findPath(map, { x: 1, y: 1 }, { x: 99, y: 99 })).toBeNull();
    expect(findPath(map, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  it('produces deterministic paths for the same inputs', () => {
    const map = grid(['......', '.#....', '.#..#.', '......']);
    const first = findPath(map, { x: 0, y: 0 }, { x: 5, y: 3 });
    const second = findPath(map, { x: 0, y: 0 }, { x: 5, y: 3 });

    expect(first).toEqual(second);
  });
});
