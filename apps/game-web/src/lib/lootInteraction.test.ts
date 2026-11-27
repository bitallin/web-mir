import { TILE_UNITS } from '@web-legend/contracts';
import { describe, expect, it } from 'vitest';

import type { LootView } from '../net/worldClient';
import {
  lootIsLocked,
  lootLockLabel,
  lootLockRemainingMs,
  lootTile,
  withinPickupRange,
} from './lootInteraction';

function drop(overrides: Partial<LootView> = {}): LootView {
  return {
    dropId: '00000000-0000-7000-8000-000000000001',
    itemId: '00000000-0000-7000-8000-000000000002',
    templateId: 'slime_gel',
    displayName: '史莱姆凝胶',
    quantity: 1,
    x: 5.5 * TILE_UNITS,
    y: 6 * TILE_UNITS,
    ownerId: '',
    ownerExpiresAt: 0,
    pickupLockedUntil: 0,
    expiresAt: 0,
    ...overrides,
  };
}

describe('loot interaction helpers', () => {
  it('reports the remaining contested lock', () => {
    const locked = drop({ pickupLockedUntil: 70_000 });
    expect(lootLockRemainingMs(locked, 10_000)).toBe(60_000);
    expect(lootLockRemainingMs(locked, 80_000)).toBe(0);
    expect(lootIsLocked(locked, 10_000)).toBe(true);
    expect(lootLockLabel(locked, 10_000)).toBe('争夺保护 60 秒');
    expect(lootLockLabel(locked, 80_000)).toBeNull();
  });

  it('walks to the drop tile and picks up only inside the authoritative range', () => {
    const gel = drop();
    expect(lootTile(gel)).toEqual({ x: 5, y: 6 });
    expect(withinPickupRange({ x: 5.5 * TILE_UNITS, y: 6 * TILE_UNITS }, gel)).toBe(true);
    expect(withinPickupRange({ x: 8 * TILE_UNITS, y: 6 * TILE_UNITS }, gel)).toBe(false);
  });
});
