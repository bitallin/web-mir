import { PICKUP_RANGE_TILES, TILE_UNITS, type TilePoint } from '@web-legend/contracts';

import type { LootView } from '../net/worldClient';

/**
 * Pure helpers for smart loot pickup (ADR-041). The server still validates the
 * lock, ownership and distance; these only decide the local affordance.
 */

export function lootLockRemainingMs(drop: LootView, now: number): number {
  return Math.max(0, drop.pickupLockedUntil - now);
}

export function lootIsLocked(drop: LootView, now: number): boolean {
  return lootLockRemainingMs(drop, now) > 0;
}

export function lootTile(drop: LootView): TilePoint {
  return {
    x: Math.floor(drop.x / TILE_UNITS),
    y: Math.floor(drop.y / TILE_UNITS),
  };
}

export function withinPickupRange(self: { x: number; y: number }, drop: LootView): boolean {
  const distance = Math.hypot(
    self.x / TILE_UNITS - drop.x / TILE_UNITS,
    self.y / TILE_UNITS - drop.y / TILE_UNITS,
  );
  return distance <= PICKUP_RANGE_TILES;
}

export function lootLockLabel(drop: LootView, now: number): string | null {
  const remaining = lootLockRemainingMs(drop, now);
  if (remaining <= 0) {
    return null;
  }
  return `争夺保护 ${String(Math.ceil(remaining / 1_000))} 秒`;
}
