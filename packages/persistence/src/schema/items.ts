import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { characters } from './characters';

export const ITEM_CONTAINERS = ['inventory', 'equipment', 'ground'] as const;
export type ItemContainer = (typeof ITEM_CONTAINERS)[number];

export const EQUIPMENT_SLOT_IDS = ['weapon', 'armor'] as const;
export type EquipmentSlotId = (typeof EQUIPMENT_SLOT_IDS)[number];

/**
 * One row per physical item instance. `container` is the single source of
 * truth for where the item is, so an instance can never be both on the ground
 * and in a bag (ADR-020). Stackable items keep a quantity on one row.
 */
export const itemInstances = pgTable(
  'item_instances',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    templateId: text('template_id').notNull(),
    characterId: uuid('character_id').references(() => characters.id, { onDelete: 'cascade' }),
    container: text('container', { enum: ITEM_CONTAINERS }).notNull(),
    slotIndex: integer('slot_index'),
    equipSlot: text('equip_slot', { enum: EQUIPMENT_SLOT_IDS }),
    quantity: integer('quantity').notNull().default(1),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('item_instances_inventory_slot_unique')
      .on(table.characterId, table.slotIndex)
      .where(sql`${table.container} = 'inventory'`),
    // Slot uniqueness is enforced by the character row lock in the equip
    // transaction: swapping two pieces legitimately passes through a state
    // where both rows are briefly in the same slot, which an immediate unique
    // index would reject (ADR-020).
    index('item_instances_equipment_slot_idx')
      .on(table.characterId, table.equipSlot)
      .where(sql`${table.container} = 'equipment'`),
    index('item_instances_character_idx').on(table.characterId, table.container),
    index('item_instances_ground_idx')
      .on(table.templateId)
      .where(sql`${table.container} = 'ground'`),
    check(
      'item_instances_placement_check',
      sql`(
        (${table.container} = 'inventory' AND ${table.characterId} IS NOT NULL
          AND ${table.slotIndex} IS NOT NULL AND ${table.equipSlot} IS NULL)
        OR (${table.container} = 'equipment' AND ${table.characterId} IS NOT NULL
          AND ${table.equipSlot} IS NOT NULL AND ${table.slotIndex} IS NULL)
        OR (${table.container} = 'ground' AND ${table.characterId} IS NULL
          AND ${table.slotIndex} IS NULL AND ${table.equipSlot} IS NULL)
      )`,
    ),
    check('item_instances_quantity_check', sql`${table.quantity} > 0`),
  ],
);

export type ItemInstance = typeof itemInstances.$inferSelect;
export type NewItemInstance = typeof itemInstances.$inferInsert;

/**
 * A visible ground drop. The item instance row already identifies the asset;
 * this table records where it lies, who may claim it first and when it expires.
 */
export const worldDrops = pgTable(
  'world_drops',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    mapId: text('map_id').notNull(),
    /** Integer sub-tile units, same coordinate system as characters. */
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    itemInstanceId: uuid('item_instance_id')
      .notNull()
      .references(() => itemInstances.id, { onDelete: 'cascade' }),
    ownerCharacterId: uuid('owner_character_id').references(() => characters.id, {
      onDelete: 'set null',
    }),
    ownerExpiresAt: timestamp('owner_expires_at', { withTimezone: true }),
    /**
     * Contested (ownerless) drops cannot be picked up before this instant
     * (ADR-041). Null for normal owned drops.
     */
    pickupLockedUntil: timestamp('pickup_locked_until', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedByCharacterId: uuid('claimed_by_character_id').references(() => characters.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('world_drops_item_unique').on(table.itemInstanceId),
    index('world_drops_open_idx').on(table.mapId, table.claimedAt, table.expiresAt),
    index('world_drops_claimant_idx').on(table.claimedByCharacterId),
  ],
);

export type WorldDrop = typeof worldDrops.$inferSelect;
export type NewWorldDrop = typeof worldDrops.$inferInsert;

/** Gold wallet. Every change also writes a currency_ledger row (AGENTS §6). */
export const wallets = pgTable(
  'wallets',
  {
    characterId: uuid('character_id')
      .primaryKey()
      .references(() => characters.id, { onDelete: 'cascade' }),
    balance: integer('balance').notNull().default(0),
    version: integer('version').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('wallets_balance_non_negative', sql`${table.balance} >= 0`)],
);

export type Wallet = typeof wallets.$inferSelect;

/** Append-only currency journal; balance and journal share one transaction. */
export const currencyLedger = pgTable(
  'currency_ledger',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    currencyType: text('currency_type').notNull().default('gold'),
    delta: integer('delta').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    reason: text('reason').notNull(),
    referenceId: text('reference_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('currency_ledger_idempotency_unique').on(table.idempotencyKey),
    index('currency_ledger_character_idx').on(table.characterId, table.createdAt),
    check('currency_ledger_balance_non_negative', sql`${table.balanceAfter} >= 0`),
  ],
);

export type CurrencyLedgerEntry = typeof currencyLedger.$inferSelect;

/**
 * Command-level idempotency for asset operations. A command id that committed
 * once can never commit twice; a rolled-back command leaves no row and may be
 * retried.
 */
export const assetCommands = pgTable(
  'asset_commands',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('asset_commands_idempotency_unique').on(table.idempotencyKey),
    index('asset_commands_character_idx').on(table.characterId, table.createdAt),
  ],
);

export type AssetCommand = typeof assetCommands.$inferSelect;
