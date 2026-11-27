import {
  and,
  asc,
  count,
  countDistinct,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
} from 'drizzle-orm';

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

/**
 * Bag stacks of one template, locked for the rest of the transaction. Turn-in
 * quests consume from these rows so a concurrent sale cannot double-spend the
 * same items (ADR-040).
 */
export async function lockInventoryItemsByTemplate(
  executor: DbExecutor,
  characterId: string,
  templateId: string,
): Promise<ItemInstance[]> {
  return executor
    .select()
    .from(itemInstances)
    .where(
      and(
        eq(itemInstances.characterId, characterId),
        eq(itemInstances.container, 'inventory'),
        eq(itemInstances.templateId, templateId),
      ),
    )
    .orderBy(asc(itemInstances.slotIndex))
    .for('update');
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

export type ItemTemplateUsage = {
  templateId: string;
  instances: number;
  characters: number;
};

/**
 * Distinct templates referenced by any live item instance. A content release
 * that drops one of these would make every holder fail asset loading on login
 * (TD-DATA-04), so publishing/activating it must be refused.
 */
export async function listItemTemplateUsage(executor: DbExecutor): Promise<ItemTemplateUsage[]> {
  const rows = await executor
    .select({
      templateId: itemInstances.templateId,
      instances: count(),
      characters: countDistinct(itemInstances.characterId),
    })
    .from(itemInstances)
    .groupBy(itemInstances.templateId);
  return rows.map((row) => ({
    templateId: row.templateId,
    instances: Number(row.instances),
    characters: Number(row.characters),
  }));
}

export type ExpiredDropCleanup = {
  /** Unclaimed expired drops removed together with their ground item row. */
  removedUnclaimed: number;
  /** Claimed drop rows whose retention window has passed. */
  archivedClaimed: number;
};

/**
 * Maintenance pass for the loot tables (TD-DATA-02). Unclaimed expired drops
 * are removed with their ground item instance; deleting the instance cascades
 * the drop row, so no invisible ground asset survives. Claimed rows are merely
 * audit history and are pruned after the retention window.
 */
export async function purgeExpiredWorldDrops(
  executor: DbExecutor,
  options: {
    now: Date;
    /** Restricts the unclaimed cleanup to one map; claimed history is global. */
    mapId?: string;
    claimedRetentionMs: number;
    limit?: number;
  },
): Promise<ExpiredDropCleanup> {
  const limit = options.limit ?? 500;
  const conditions = [
    isNull(worldDrops.claimedAt),
    lt(worldDrops.expiresAt, options.now),
    eq(itemInstances.container, 'ground'),
  ];
  if (options.mapId !== undefined) {
    conditions.push(eq(worldDrops.mapId, options.mapId));
  }

  const expired = await executor
    .select({ itemId: worldDrops.itemInstanceId })
    .from(worldDrops)
    .innerJoin(itemInstances, eq(itemInstances.id, worldDrops.itemInstanceId))
    .where(and(...conditions))
    .limit(limit);

  let removedUnclaimed = 0;
  if (expired.length > 0) {
    // Re-check the placement in the DELETE: a pickup may have moved one of
    // these instances into a bag between the SELECT and the DELETE.
    const removed = await executor
      .delete(itemInstances)
      .where(
        and(
          inArray(
            itemInstances.id,
            expired.map((row) => row.itemId),
          ),
          eq(itemInstances.container, 'ground'),
          isNull(itemInstances.characterId),
        ),
      )
      .returning({ id: itemInstances.id });
    removedUnclaimed = removed.length;
  }

  const retentionCutoff = new Date(options.now.getTime() - options.claimedRetentionMs);
  const archived = await executor
    .delete(worldDrops)
    .where(and(isNotNull(worldDrops.claimedAt), lt(worldDrops.expiresAt, retentionCutoff)))
    .returning({ id: worldDrops.id });

  return { removedUnclaimed, archivedClaimed: archived.length };
}
