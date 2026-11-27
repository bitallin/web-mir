import { TILE_UNITS } from '@web-legend/contracts';
import { describe, expect, it } from 'vitest';

import { buildPredictionWaypoints } from './movementPrediction';

const path = (...tiles: [number, number][]) => tiles.map(([x, y]) => ({ x, y }));

describe('client movement prediction', () => {
  it('continues straight when a repath keeps the current direction', () => {
    // Mid-tile heading east: 400 units past the center of tile 2.
    const waypoints = buildPredictionWaypoints({ x: 2_900, y: 1_500 }, path([3, 1], [4, 1]));

    expect(waypoints[0]).toEqual({ x: 3_500, y: 1_500 });
    expect(waypoints).toHaveLength(2);
  });

  it('drops the server starting tile before the straight check', () => {
    // Real acks include the server's starting tile, which is also the tile the
    // predicting client is standing in.
    const waypoints = buildPredictionWaypoints(
      { x: 2_900, y: 1_500 },
      path([2, 1], [3, 1], [4, 1]),
    );

    expect(waypoints[0]).toEqual({ x: 3_500, y: 1_500 });
    expect(waypoints).toHaveLength(2);
  });

  it('turns inside the next tile for a perpendicular retarget', () => {
    const waypoints = buildPredictionWaypoints({ x: 2_900, y: 1_500 }, path([2, 0], [2, -1]));

    // Continue north from the current x, then align to the next tile center:
    // no backward step to this tile's center.
    expect(waypoints[0]).toEqual({ x: 2_900, y: 500 });
    expect(waypoints[1]).toEqual({ x: 2_500, y: 500 });
    expect(waypoints[2]).toEqual({ x: 2_500, y: -500 });
  });

  it('turns inside the next tile when the ack path includes the current tile', () => {
    const waypoints = buildPredictionWaypoints(
      { x: 2_900, y: 1_500 },
      path([2, 1], [2, 2], [2, 3]),
    );

    expect(waypoints[0]).toEqual({ x: 2_900, y: 2_500 });
    expect(waypoints[1]).toEqual({ x: 2_500, y: 2_500 });
  });

  it('drops server path nodes that the client has already passed', () => {
    // The server computed the path from tile 4 while the client is in tile 6.
    const waypoints = buildPredictionWaypoints(
      { x: 6_500, y: 5_500 },
      path([4, 5], [5, 5], [6, 5], [7, 5], [8, 5]),
    );

    expect(waypoints).toEqual([
      { x: 7_500, y: 5_500 },
      { x: 8_500, y: 5_500 },
    ]);
  });

  it('finishes the current step when the server clears the path', () => {
    const waypoints = buildPredictionWaypoints({ x: 2_900, y: 1_500 }, []);

    expect(waypoints).toEqual([{ x: 2_500, y: 1_500 }]);
  });

  it('keeps the player in place when already at a tile center', () => {
    const start = { x: 2 * TILE_UNITS + TILE_UNITS / 2, y: 1 * TILE_UNITS + TILE_UNITS / 2 };
    expect(buildPredictionWaypoints(start, [])).toEqual([]);
    expect(buildPredictionWaypoints(start, path([3, 1]))).toEqual([{ x: 3_500, y: 1_500 }]);
  });
});
