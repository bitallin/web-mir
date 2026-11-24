import { TILE_UNITS } from '@web-legend/contracts';
import { describe, expect, it } from 'vitest';

import { createProjection, TILE_HEIGHT, TILE_WIDTH } from './projection';

const map = { width: 30, height: 20 };
const projection = createProjection(map);

describe('isometric projection', () => {
  it('round-trips a tile center through screen space', () => {
    for (const tile of [
      { x: 0, y: 0 },
      { x: 15, y: 10 },
      { x: 29, y: 19 },
    ]) {
      const screen = projection.tileCenter(tile);
      expect(projection.toTile(screen.x, screen.y)).toEqual(tile);
    }
  });

  it('places the map inside positive screen bounds', () => {
    const top = projection.toScreen(0, 0);
    const bottomRight = projection.toScreen(map.width * TILE_UNITS, map.height * TILE_UNITS);

    expect(top.x).toBeGreaterThanOrEqual(0);
    expect(top.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(projection.mapWidth);
    expect(bottomRight.y).toBeLessThanOrEqual(projection.mapHeight);
  });

  it('steps one tile east by half a tile width and half a tile height', () => {
    const from = projection.tileCenter({ x: 10, y: 10 });
    const to = projection.tileCenter({ x: 11, y: 10 });

    expect(to.x - from.x).toBe(TILE_WIDTH / 2);
    expect(to.y - from.y).toBe(TILE_HEIGHT / 2);
  });

  it('maps a fractional logical position between tile centers', () => {
    const screen = projection.toScreen(
      10 * TILE_UNITS + TILE_UNITS / 2 + 400,
      10 * TILE_UNITS + TILE_UNITS / 2,
    );
    const center = projection.tileCenter({ x: 10, y: 10 });

    expect(screen.x).toBeGreaterThan(center.x);
    expect(screen.y).toBeGreaterThan(center.y);
    expect(projection.toTile(screen.x, screen.y)).toEqual({ x: 10, y: 10 });
  });
});
