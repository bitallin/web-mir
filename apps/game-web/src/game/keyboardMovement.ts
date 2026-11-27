import type { TilePoint } from '@web-legend/contracts';

export type MovementDirectionKey = 'up' | 'down' | 'left' | 'right';

const DIRECTION_BY_KEY: Readonly<Record<string, MovementDirectionKey>> = {
  w: 'up',
  arrowup: 'up',
  s: 'down',
  arrowdown: 'down',
  a: 'left',
  arrowleft: 'left',
  d: 'right',
  arrowright: 'right',
};

export function movementDirectionForKey(key: string): MovementDirectionKey | null {
  return DIRECTION_BY_KEY[key.toLowerCase()] ?? null;
}

/** Tile delta for the held keys; opposite keys cancel, two axes turn diagonal. */
export function directionFromHeldKeys(held: ReadonlySet<string>): TilePoint | null {
  let x = 0;
  let y = 0;
  for (const key of held) {
    switch (movementDirectionForKey(key)) {
      case 'up':
        y -= 1;
        break;
      case 'down':
        y += 1;
        break;
      case 'left':
        x -= 1;
        break;
      case 'right':
        x += 1;
        break;
      default:
        break;
    }
  }
  if (x === 0 && y === 0) {
    return null;
  }
  return { x, y };
}

/**
 * Client-side mirror of the server's eight-direction step rule (ADR-043): a
 * diagonal step needs both orthogonal neighbours walkable so the character
 * never cuts a blocked corner.
 */
export function isEightWayStepAllowed(
  from: TilePoint,
  to: TilePoint,
  isWalkable: (tile: TilePoint) => boolean,
): boolean {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  if (deltaX === 0 && deltaY === 0) {
    return false;
  }
  if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
    return false;
  }
  if (!isWalkable(to)) {
    return false;
  }
  if (deltaX !== 0 && deltaY !== 0) {
    return (
      isWalkable({ x: from.x + deltaX, y: from.y }) && isWalkable({ x: from.x, y: from.y + deltaY })
    );
  }
  return true;
}
