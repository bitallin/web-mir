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
 * so leading nodes already behind the player are dropped. If the next node is
 * in the current direction of travel the player continues straight; otherwise
 * the current tile center is inserted so every turn stays axis-aligned. This
 * mirrors the server's movement rules (ADR-016) and keeps repaths from pulling
 * the character backwards (see the simulation's `setPath`).
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

  const center = tileCenter(currentTile);
  const offsetX = start.x - center.x;
  const offsetY = start.y - center.y;
  const first = effective[0];

  const waypoints: PredictionPoint[] = [];
  if (first === undefined) {
    if (offsetX !== 0 || offsetY !== 0) {
      waypoints.push(center);
    }
  } else if (offsetX !== 0) {
    if (first.y === currentTile.y) {
      // Same row: continue (or reverse) straight horizontally.
    } else if (first.x === currentTile.x) {
      // Perpendicular turn: turn inside the next tile instead of stepping
      // back to this tile's center.
      waypoints.push({ x: start.x, y: tileCenter(first).y });
    } else {
      waypoints.push(center);
    }
  } else if (offsetY !== 0) {
    if (first.x === currentTile.x) {
      // Same column: continue (or reverse) straight vertically.
    } else if (first.y === currentTile.y) {
      waypoints.push({ x: tileCenter(first).x, y: start.y });
    } else {
      waypoints.push(center);
    }
  }
  for (const node of effective) {
    waypoints.push(tileCenter(node));
  }
  return waypoints.filter((point) => point.x !== start.x || point.y !== start.y);
}
