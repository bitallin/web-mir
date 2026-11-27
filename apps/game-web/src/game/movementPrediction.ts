import { TILE_UNITS, type TilePoint } from '@web-legend/contracts';

export type PredictionPoint = { x: number; y: number };

function tileCenter(tile: TilePoint): PredictionPoint {
  return {
    x: tile.x * TILE_UNITS + TILE_UNITS / 2,
    y: tile.y * TILE_UNITS + TILE_UNITS / 2,
  };
}

/**
 * Builds the waypoints the client predicts along for a server-approved path.
 * The client is usually slightly ahead of the server that computed the path,
 * so leading nodes already behind the player are dropped. The player then
 * walks straight to each tile center: with eight-direction movement a segment
 * from a mid-tile offset is legal and never requires returning to the old
 * center (ADR-043). Mirrors the simulation's `setPath`.
 */
export function buildPredictionWaypoints(
  start: PredictionPoint,
  path: readonly TilePoint[],
): PredictionPoint[] {
  const currentTile = {
    x: Math.floor(start.x / TILE_UNITS),
    y: Math.floor(start.y / TILE_UNITS),
  };

  // The server's ack path starts with the tile the server was standing on.
  // That tile is already behind (or under) the predicting client, so drop it
  // and continue from the next node; keeping it would force a return to its
  // center and make every repath a backwards step.
  let effective = path;
  const currentIndex = path.findIndex(
    (node) => node.x === currentTile.x && node.y === currentTile.y,
  );
  if (currentIndex >= 0) {
    effective = path.slice(currentIndex + 1);
  }

  const waypoints: PredictionPoint[] = effective.map(tileCenter);
  if (waypoints.length === 0) {
    // Stopping: finish the current step at the tile center.
    const center = tileCenter(currentTile);
    if (center.x !== start.x || center.y !== start.y) {
      waypoints.push(center);
    }
  }
  return waypoints.filter((point) => point.x !== start.x || point.y !== start.y);
}
