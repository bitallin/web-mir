import { describe, expect, it } from 'vitest';

import {
  INVENTORY_CAPACITY,
  SHOP_MAX_QUANTITY,
  assetResultSchema,
  inventoryEquipSchema,
  inventorySnapshotSchema,
  inventoryUseSchema,
  itemViewSchema,
  lootPickupSchema,
  shopBuySchema,
  shopCatalogSchema,
  shopSellSchema,
} from './economy';
import { PlayerState, LootState, WorldState } from './worldState';

const ITEM_ID = '0190f2a0-0000-7000-8000-000000000001';
const CHARACTER_ID = '0190f2a0-0000-7000-8000-000000000002';
const COMMAND_ID = '0190f2a0-0000-7000-8000-000000000003';

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    itemId: ITEM_ID,
    templateId: 'small_hp_potion',
    name: '金创药',
    kind: 'consumable',
    quantity: 2,
    slotIndex: 0,
    levelRequirement: 1,
    attackBonus: 0,
    defenseBonus: 0,
    maxHpBonus: 0,
    maxMpBonus: 0,
    healHp: 40,
    healMp: 0,
    ...overrides,
  };
}

describe('economy command schemas', () => {
  it('accepts a pickup command with only intent fields', () => {
    const parsed = lootPickupSchema.parse({
      protocolVersion: 1,
      commandId: COMMAND_ID,
      clientSequence: 4,
      dropId: ITEM_ID,
    });
    expect(parsed.dropId).toBe(ITEM_ID);
  });

  it('rejects client-supplied rewards or extra fields', () => {
    const result = lootPickupSchema.safeParse({
      protocolVersion: 1,
      commandId: COMMAND_ID,
      clientSequence: 4,
      dropId: ITEM_ID,
      gold: 999,
    });
    expect(result.success).toBe(false);
  });

  it('requires an item id for use and equip', () => {
    expect(
      inventoryUseSchema.safeParse({
        protocolVersion: 1,
        commandId: COMMAND_ID,
        clientSequence: 1,
      }).success,
    ).toBe(false);
    expect(
      inventoryEquipSchema.safeParse({
        protocolVersion: 1,
        commandId: COMMAND_ID,
        clientSequence: 1,
        itemId: ITEM_ID,
      }).success,
    ).toBe(true);
  });
});

describe('shop command schemas', () => {
  it('accepts buy and sell intents without client-side prices', () => {
    const buy = shopBuySchema.parse({
      protocolVersion: 1,
      commandId: COMMAND_ID,
      clientSequence: 7,
      merchantId: 'town_merchant',
      templateId: 'small_hp_potion',
      quantity: 2,
    });
    expect(buy.quantity).toBe(2);

    const sell = shopSellSchema.parse({
      protocolVersion: 1,
      commandId: COMMAND_ID,
      clientSequence: 8,
      merchantId: 'town_merchant',
      itemId: ITEM_ID,
      quantity: 1,
    });
    expect(sell.itemId).toBe(ITEM_ID);
  });

  it('rejects forged prices, invalid merchants and out-of-range quantities', () => {
    const base = {
      protocolVersion: 1,
      commandId: COMMAND_ID,
      clientSequence: 7,
      merchantId: 'town_merchant',
      templateId: 'small_hp_potion',
      quantity: 1,
    };
    expect(shopBuySchema.safeParse({ ...base, price: 1 }).success).toBe(false);
    expect(shopBuySchema.safeParse({ ...base, merchantId: 'Town Merchant' }).success).toBe(false);
    expect(shopBuySchema.safeParse({ ...base, quantity: 0 }).success).toBe(false);
    expect(shopBuySchema.safeParse({ ...base, quantity: SHOP_MAX_QUANTITY + 1 }).success).toBe(
      false,
    );
  });

  it('parses a catalog with merchants, offers and sell prices', () => {
    const catalog = shopCatalogSchema.parse({
      merchants: [{ id: 'town_merchant', name: '杂货商', tile: { x: 12, y: 8 } }],
      offers: [
        {
          templateId: 'small_hp_potion',
          name: '金创药',
          kind: 'consumable',
          buyPrice: 15,
          levelRequirement: 1,
          stackable: true,
          maxStack: 20,
          attackBonus: 0,
          defenseBonus: 0,
          maxHpBonus: 0,
          maxMpBonus: 0,
          healHp: 40,
          healMp: 0,
        },
      ],
      sellPrices: [{ templateId: 'slime_gel', sellPrice: 4 }],
    });
    expect(catalog.offers[0]?.buyPrice).toBe(15);
    expect(catalog.sellPrices[0]?.sellPrice).toBe(4);
  });
});

describe('inventory snapshot schema', () => {
  it('round-trips a complete private snapshot', () => {
    const snapshot = inventorySnapshotSchema.parse({
      characterId: CHARACTER_ID,
      level: 1,
      exp: 5,
      expToNextLevel: 30,
      gold: 7,
      hp: 100,
      maxHp: 120,
      mp: 20,
      maxMp: 30,
      attack: 18,
      defense: 10,
      capacity: INVENTORY_CAPACITY,
      items: [item()],
      equipment: {
        weapon: item({
          itemId: '0190f2a0-0000-7000-8000-000000000004',
          templateId: 'warrior_sword',
          name: '铁剑',
          kind: 'weapon',
          quantity: 1,
          slotIndex: undefined,
          equipSlot: 'weapon',
          attackBonus: 6,
        }),
        armor: null,
      },
    });
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.equipment.weapon?.attackBonus).toBe(6);
  });

  it('rejects more items than the bag can hold and forged bonuses', () => {
    const items = Array.from({ length: INVENTORY_CAPACITY + 1 }, (_, index) =>
      item({ itemId: `0190f2a0-0000-7000-8000-0000000000${String(index).padStart(2, '0')}` }),
    );
    expect(
      inventorySnapshotSchema.safeParse({
        characterId: CHARACTER_ID,
        level: 1,
        exp: 0,
        expToNextLevel: 30,
        gold: 0,
        hp: 1,
        maxHp: 1,
        mp: 0,
        maxMp: 0,
        attack: 0,
        defense: 0,
        capacity: INVENTORY_CAPACITY,
        items,
        equipment: { weapon: null, armor: null },
      }).success,
    ).toBe(false);
    expect(itemViewSchema.safeParse(item({ attackBonus: -5 })).success).toBe(false);
  });

  it('accepts an asset result with the committed snapshot', () => {
    const result = assetResultSchema.safeParse({
      commandId: COMMAND_ID,
      kind: 'loot_pickup',
      deduplicated: false,
      snapshot: {
        characterId: CHARACTER_ID,
        level: 1,
        exp: 0,
        expToNextLevel: 30,
        gold: 0,
        hp: 10,
        maxHp: 120,
        mp: 0,
        maxMp: 30,
        attack: 12,
        defense: 8,
        capacity: INVENTORY_CAPACITY,
        items: [],
        equipment: { weapon: null, armor: null },
      },
      serverTime: 1,
    });
    expect(result.success).toBe(true);
  });
});

describe('world state loot collection', () => {
  it('carries public drop data and stays independent of private inventory', () => {
    const state = new WorldState();
    const loot = new LootState();
    loot.dropId = ITEM_ID;
    loot.itemId = ITEM_ID;
    loot.templateId = 'slime_gel';
    loot.displayName = '史莱姆凝胶';
    loot.quantity = 2;
    loot.x = 7_500;
    loot.y = 15_500;
    loot.ownerId = CHARACTER_ID;
    loot.expiresAt = 1_700_000_000_000;
    state.loot.set(loot.dropId, loot);

    expect(state.loot.get(ITEM_ID)?.displayName).toBe('史莱姆凝胶');
    expect(new PlayerState().level).toBe(1);
  });
});
