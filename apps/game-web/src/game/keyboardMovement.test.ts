import { describe, expect, it } from 'vitest';

import {
  directionFromHeldKeys,
  isEightWayStepAllowed,
  movementDirectionForKey,
} from './keyboardMovement';

describe('keyboard movement', () => {
  it('maps WASD and arrow keys to directions', () => {
    expect(movementDirectionForKey('w')).toBe('up');
    expect(movementDirectionForKey('ArrowDown')).toBe('down');
    expect(movementDirectionForKey('A')).toBe('left');
    expect(movementDirectionForKey('arrowright')).toBe('right');
    expect(movementDirectionForKey('q')).toBeNull();
  });

  it('combines two held keys into a diagonal tile delta', () => {
    expect(directionFromHeldKeys(new Set(['w', 'd']))).toEqual({ x: 1, y: -1 });
    expect(directionFromHeldKeys(new Set(['arrowdown', 'arrowleft']))).toEqual({ x: -1, y: 1 });
  });

  it('cancels opposite keys and reports no direction when nothing is held', () => {
    expect(directionFromHeldKeys(new Set())).toBeNull();
    expect(directionFromHeldKeys(new Set(['a', 'd']))).toBeNull();
    expect(directionFromHeldKeys(new Set(['w', 's', 'd']))).toEqual({ x: 1, y: 0 });
  });

  it('allows a diagonal step only when both orthogonal neighbours are walkable', () => {
    const open = (): boolean => true;
    const blockedEast = (tile: { x: number; y: number }): boolean =>
      !(tile.x === 2 && tile.y === 1);

    expect(isEightWayStepAllowed({ x: 1, y: 1 }, { x: 2, y: 2 }, open)).toBe(true);
    // East neighbour (2,1) is blocked: the diagonal would cut the corner.
    expect(isEightWayStepAllowed({ x: 1, y: 1 }, { x: 2, y: 2 }, blockedEast)).toBe(false);
    expect(isEightWayStepAllowed({ x: 1, y: 1 }, { x: 2, y: 1 }, open)).toBe(true);
    expect(isEightWayStepAllowed({ x: 1, y: 1 }, { x: 3, y: 1 }, open)).toBe(false);
    expect(isEightWayStepAllowed({ x: 1, y: 1 }, { x: 2, y: 1 }, (tile) => tile.x === 1)).toBe(
      false,
    );
  });
});
