import { z } from 'zod';

import { tilePointSchema } from './map';

/**
 * Phase-5 asset wire contract. The browser only ever asks to pick up a drop or
 * to move an item it already owns; every quantity, price, stat and reward is
 * computed by the server and confirmed after the database transaction commits
 * (ADR-020).
 */

export const ECONOMY_CONTENT_VERSION = 'phase5.1' as const;

export const INVENTORY_CAPACITY = 24 as const;
export const PICKUP_RANGE_TILES = 1.5 as const;
/** Drops are reserved for the killer for this long, then become free for all. */
export const LOOT_OWNER_WINDOW_MS = 30_000 as const;
/** Unclaimed drops disappear this long after they were created. */
export const LOOT_EXPIRY_MS = 120_000 as const;
/** A merchant can be used from this many tiles away. */
export const SHOP_RANGE_TILES = 3 as const;
/** One shop command may move at most this many units. */
export const SHOP_MAX_QUANTITY = 99 as const;

export const ITEM_KINDS = ['weapon', 'armor', 'consumable', 'material'] as const;
export const itemKindSchema = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof itemKindSchema>;

export const EQUIPMENT_SLOTS = ['weapon', 'armor'] as const;
export const equipmentSlotSchema = z.enum(EQUIPMENT_SLOTS);
export type EquipmentSlot = z.infer<typeof equipmentSlotSchema>;

const templateIdSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z][a-z0-9_]*$/, 'item template id must be lowercase snake_case');

/**
 * Public view of one item instance. It is sent privately over the realtime
 * connection for the owner's inventory and publicly as part of a ground drop.
 */
export const itemViewSchema = z
  .object({
    itemId: z.uuid(),
    templateId: templateIdSchema,
    name: z.string().min(1).max(24),
    kind: itemKindSchema,
    quantity: z.number().int().min(1).max(999),
    slotIndex: z
      .number()
      .int()
      .min(0)
      .max(INVENTORY_CAPACITY - 1)
      .optional(),
    equipSlot: equipmentSlotSchema.optional(),
    levelRequirement: z.number().int().min(1),
    attackBonus: z.number().int().nonnegative(),
    defenseBonus: z.number().int().nonnegative(),
    maxHpBonus: z.number().int().nonnegative(),
    maxMpBonus: z.number().int().nonnegative(),
    healHp: z.number().int().nonnegative(),
    healMp: z.number().int().nonnegative(),
  })
  .strict();

export type ItemView = z.infer<typeof itemViewSchema>;

export const equipmentViewSchema = z
  .object({
    weapon: itemViewSchema.nullable(),
    armor: itemViewSchema.nullable(),
  })
  .strict();

export type EquipmentView = z.infer<typeof equipmentViewSchema>;

/**
 * Complete private asset state for one character. Delivered after the join
 * handshake and after every committed asset command; it never enters the
 * public room state.
 */
export const inventorySnapshotSchema = z
  .object({
    characterId: z.uuid(),
    level: z.number().int().min(1),
    exp: z.number().int().nonnegative(),
    expToNextLevel: z.number().int().nonnegative(),
    gold: z.number().int().nonnegative(),
    hp: z.number().int().nonnegative(),
    maxHp: z.number().int().positive(),
    mp: z.number().int().nonnegative(),
    maxMp: z.number().int().nonnegative(),
    attack: z.number().int().nonnegative(),
    defense: z.number().int().nonnegative(),
    capacity: z.number().int().positive(),
    items: z.array(itemViewSchema).max(INVENTORY_CAPACITY),
    equipment: equipmentViewSchema,
  })
  .strict();

export type InventorySnapshot = z.infer<typeof inventorySnapshotSchema>;

export const assetCommandKindSchema = z.enum([
  'loot_pickup',
  'inventory_equip',
  'inventory_unequip',
  'inventory_use',
  'shop_buy',
  'shop_sell',
]);

export type AssetCommandKind = z.infer<typeof assetCommandKindSchema>;

const assetCommandBase = {
  protocolVersion: z.number().int().positive(),
  commandId: z.uuid(),
  clientSequence: z.number().int().min(0).max(2_147_483_647),
};

export const lootPickupSchema = z
  .object({
    ...assetCommandBase,
    dropId: z.uuid(),
  })
  .strict();

export type LootPickup = z.infer<typeof lootPickupSchema>;

export const inventoryEquipSchema = z
  .object({
    ...assetCommandBase,
    itemId: z.uuid(),
  })
  .strict();

export type InventoryEquip = z.infer<typeof inventoryEquipSchema>;

export const inventoryUnequipSchema = z
  .object({
    ...assetCommandBase,
    slot: equipmentSlotSchema,
  })
  .strict();

export type InventoryUnequip = z.infer<typeof inventoryUnequipSchema>;

export const inventoryUseSchema = z
  .object({
    ...assetCommandBase,
    itemId: z.uuid(),
  })
  .strict();

export type InventoryUse = z.infer<typeof inventoryUseSchema>;

const merchantIdSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z][a-z0-9_]*$/, 'merchant id must be lowercase snake_case');

export const shopBuySchema = z
  .object({
    ...assetCommandBase,
    merchantId: merchantIdSchema,
    templateId: templateIdSchema,
    quantity: z.number().int().min(1).max(SHOP_MAX_QUANTITY),
  })
  .strict();

export type ShopBuy = z.infer<typeof shopBuySchema>;

export const shopSellSchema = z
  .object({
    ...assetCommandBase,
    merchantId: merchantIdSchema,
    itemId: z.uuid(),
    quantity: z.number().int().min(1).max(SHOP_MAX_QUANTITY),
  })
  .strict();

export type ShopSell = z.infer<typeof shopSellSchema>;

export const shopMerchantSchema = z
  .object({
    id: merchantIdSchema,
    name: z.string().min(1).max(32),
    tile: tilePointSchema,
  })
  .strict();

export type ShopMerchant = z.infer<typeof shopMerchantSchema>;

/** One purchasable template. Prices always come from the server content bundle. */
export const shopOfferSchema = z
  .object({
    templateId: templateIdSchema,
    name: z.string().min(1).max(24),
    kind: itemKindSchema,
    buyPrice: z.number().int().positive(),
    levelRequirement: z.number().int().min(1),
    stackable: z.boolean(),
    maxStack: z.number().int().min(1).max(1_000),
    attackBonus: z.number().int().nonnegative(),
    defenseBonus: z.number().int().nonnegative(),
    maxHpBonus: z.number().int().nonnegative(),
    maxMpBonus: z.number().int().nonnegative(),
    healHp: z.number().int().nonnegative(),
    healMp: z.number().int().nonnegative(),
  })
  .strict();

export type ShopOffer = z.infer<typeof shopOfferSchema>;

export const shopSellPriceSchema = z
  .object({
    templateId: templateIdSchema,
    sellPrice: z.number().int().positive(),
  })
  .strict();

export type ShopSellPrice = z.infer<typeof shopSellPriceSchema>;

/**
 * Private shop state for one map. Offers are already filtered to the player's
 * class; prices are display values copied from the room's fixed content
 * release. The server recomputes every price when a command arrives.
 */
export const shopCatalogSchema = z
  .object({
    merchants: z.array(shopMerchantSchema).max(16),
    offers: z.array(shopOfferSchema).max(200),
    sellPrices: z.array(shopSellPriceSchema).max(200),
  })
  .strict();

export type ShopCatalog = z.infer<typeof shopCatalogSchema>;

/** Sent only after the transaction that owns the asset change has committed. */
export const assetResultSchema = z
  .object({
    commandId: z.uuid(),
    kind: assetCommandKindSchema,
    deduplicated: z.boolean(),
    snapshot: inventorySnapshotSchema,
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type AssetResult = z.infer<typeof assetResultSchema>;

export const characterProgressSchema = z
  .object({
    level: z.number().int().min(1),
    exp: z.number().int().nonnegative(),
    expToNextLevel: z.number().int().nonnegative(),
    gold: z.number().int().nonnegative(),
    hp: z.number().int().nonnegative(),
    maxHp: z.number().int().positive(),
    mp: z.number().int().nonnegative(),
    maxMp: z.number().int().nonnegative(),
    attack: z.number().int().nonnegative(),
    defense: z.number().int().nonnegative(),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type CharacterProgress = z.infer<typeof characterProgressSchema>;

export const levelUpSchema = z
  .object({
    level: z.number().int().min(2).max(100),
    maxHp: z.number().int().positive(),
    maxMp: z.number().int().nonnegative(),
    attack: z.number().int().nonnegative(),
    defense: z.number().int().nonnegative(),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type LevelUp = z.infer<typeof levelUpSchema>;

export const lootClaimedSchema = z
  .object({
    dropId: z.uuid(),
    itemId: z.uuid(),
    templateId: templateIdSchema,
    name: z.string().min(1).max(24),
    quantity: z.number().int().min(1).max(999),
    claimerId: z.uuid(),
    claimerName: z.string().min(1).max(32),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type LootClaimed = z.infer<typeof lootClaimedSchema>;

export function itemsBySlot(items: readonly ItemView[]): Map<number, ItemView> {
  return new Map(items.map((item) => [item.slotIndex ?? -1, item]));
}
