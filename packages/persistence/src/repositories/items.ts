import { and, asc, eq, gt, isNull } from 'drizzle-orm';

import type { DbExecutor } from '../client';
import {
  itemInstances,
  wallets,
  worldDrops,
  type ItemInstance,
  type Wallet,
  type WorldDrop,
} from '../schema/index';

export async function listInventoryItems(
  executor: DbExecutor,
  characterId: string,
): Promise<ItemInstance[]> {
  return executor
    .select()
    .from(itemInstances)
    .where(
      and(eq(itemInstances.characterId, characterId), eq(itemInstances.container, 'inventory')),
    )
    .orderBy(asc(itemInstances.slotIndex));
}

export async function listEquippedItems(
  executor: DbExecutor,
  characterId: string,
): Promise<ItemInstance[]> {
  return executor
    .select()
    .from(itemInstances)
    .where(
      and(eq(itemInstances.characterId, characterId), eq(itemInstances.container, 'equipment')),
    )
    .orderBy(asc(itemInstances.equipSlot));
}

export async function findWallet(
  executor: DbExecutor,
  characterId: string,
): Promise<Wallet | undefined> {
  const [wallet] = await executor
    .select()
    .from(wallets)
    .where(eq(wallets.characterId, characterId))
    .limit(1);
  return wallet;
}

export type OpenWorldDrop = { drop: WorldDrop; item: ItemInstance };

/** Unclaimed, unexpired drops used to rebuild the room's visible loot state. */
export async function listOpenWorldDrops(
  executor: DbExecutor,
  mapId: string,
  now: Date,
): Promise<OpenWorldDrop[]> {
  const rows = await executor
    .select({ drop: worldDrops, item: itemInstances })
    .from(worldDrops)
    .innerJoin(itemInstances, eq(itemInstances.id, worldDrops.itemInstanceId))
    .where(
      and(
        eq(worldDrops.mapId, mapId),
        isNull(worldDrops.claimedAt),
        gt(worldDrops.expiresAt, now),
        eq(itemInstances.container, 'ground'),
      ),
    )
    .orderBy(asc(worldDrops.createdAt));
  return rows;
}
