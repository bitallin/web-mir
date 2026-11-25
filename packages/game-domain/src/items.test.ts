import { describe, expect, it } from 'vitest';

import { combatStatsFor } from './stats';
import {
  ITEM_CATALOG,
  STARTER_GOLD,
  STARTER_KIT,
  canEquip,
  equipmentBonuses,
  findInventoryPlacement,
  isConsumable,
  isShopQuantityAllowed,
  itemBuyPrice,
  itemSellPrice,
  purchaseCost,
  requireItem,
  saleValue,
  statsWithEquipment,
  type InventoryStack,
} from './items';

describe('item catalog', () => {
  it('defines valid bonuses and stack sizes for every template', () => {
    for (const [templateId, item] of Object.entries(ITEM_CATALOG)) {
      expect(item.id).toBe(templateId);
      expect(item.levelRequirement).toBeGreaterThanOrEqual(1);
      expect(item.maxStack).toBeGreaterThanOrEqual(1);
      if (item.stackable) {
        expect(item.maxStack).toBeGreaterThan(1);
      } else {
        expect(item.maxStack).toBe(1);
      }
      if (item.kind === 'weapon' || item.kind === 'armor') {
        expect(item.equipSlot).toBeDefined();
      }
    }
  });

  it('gives each class a usable starter weapon and potions', () => {
    for (const classId of ['warrior', 'mage', 'taoist'] as const) {
      const kit = STARTER_KIT[classId];
      expect(kit.length).toBeGreaterThan(0);
      const weapon = kit.find((entry) => requireItem(entry.templateId).kind === 'weapon');
      expect(weapon).toBeDefined();
      expect(canEquip(requireItem(weapon!.templateId), classId, 1)).toBe('ok');
      const potions = kit.filter((entry) => requireItem(entry.templateId).kind === 'consumable');
      expect(potions.length).toBeGreaterThan(0);
    }
  });

  it('rejects unknown templates', () => {
    expect(() => requireItem('missing_item')).toThrow(RangeError);
  });
});

describe('equip rules', () => {
  it('enforces class, level and equippability', () => {
    expect(canEquip(requireItem('warrior_sword'), 'warrior', 1)).toBe('ok');
    expect(canEquip(requireItem('warrior_sword'), 'mage', 1)).toBe('wrongClass');
    expect(canEquip(requireItem('leather_armor'), 'warrior', 1)).toBe('levelTooLow');
    expect(canEquip(requireItem('leather_armor'), 'warrior', 3)).toBe('ok');
    expect(canEquip(requireItem('slime_gel'), 'warrior', 10)).toBe('notEquippable');
  });

  it('adds only the equipped bonuses on top of class stats', () => {
    const base = combatStatsFor('warrior', 1);
    const bonuses = equipmentBonuses([requireItem('warrior_sword'), requireItem('cloth_armor')]);
    const equipped = statsWithEquipment(base, bonuses);

    expect(equipped.attack).toBe(base.attack + 6);
    expect(equipped.defense).toBe(base.defense + 2);
    expect(equipped.maxHp).toBe(base.maxHp);
    expect(base.attack).toBe(12);
  });

  it('marks only healing consumables as usable', () => {
    expect(isConsumable(requireItem('small_hp_potion'))).toBe(true);
    expect(isConsumable(requireItem('small_mp_potion'))).toBe(true);
    expect(isConsumable(requireItem('warrior_sword'))).toBe(false);
    expect(isConsumable(requireItem('wolf_pelt'))).toBe(false);
  });
});

describe('inventory placement', () => {
  const stack = (
    itemId: string,
    templateId: string,
    quantity: number,
    slotIndex: number,
  ): InventoryStack => ({ itemId, templateId, quantity, slotIndex });

  it('merges into an existing stack with room', () => {
    const placement = findInventoryPlacement({
      items: [stack('a', 'small_hp_potion', 5, 0)],
      templateId: 'small_hp_potion',
      quantity: 3,
      capacity: 24,
    });
    expect(placement).toEqual({ kind: 'merge', targetItemId: 'a', resultingQuantity: 8 });
  });

  it('uses the lowest free slot when no stack has room', () => {
    const placement = findInventoryPlacement({
      items: [stack('a', 'small_hp_potion', 19, 0), stack('b', 'wolf_pelt', 1, 2)],
      templateId: 'small_hp_potion',
      quantity: 2,
      capacity: 24,
    });
    expect(placement).toEqual({ kind: 'slot', slotIndex: 1 });
  });

  it('never stacks non-stackable equipment', () => {
    const placement = findInventoryPlacement({
      items: [stack('a', 'warrior_sword', 1, 4)],
      templateId: 'warrior_sword',
      quantity: 1,
      capacity: 24,
    });
    expect(placement).toEqual({ kind: 'slot', slotIndex: 0 });
  });

  it('returns null when the bag has no room', () => {
    const items = Array.from({ length: 24 }, (_, index) =>
      stack(`i${String(index)}`, 'slime_gel', 50, index),
    );
    expect(
      findInventoryPlacement({
        items,
        templateId: 'wolf_pelt',
        quantity: 1,
        capacity: 24,
      }),
    ).toBeNull();
  });

  it('rejects a quantity larger than one stack', () => {
    expect(
      findInventoryPlacement({
        items: [],
        templateId: 'small_hp_potion',
        quantity: 21,
        capacity: 24,
      }),
    ).toBeNull();
  });
});

describe('merchant pricing', () => {
  it('reads prices from content and keeps buy price above sell price', () => {
    for (const item of Object.values(ITEM_CATALOG)) {
      const buy = itemBuyPrice(item);
      const sell = itemSellPrice(item);
      expect(buy).toBeGreaterThanOrEqual(0);
      expect(sell).toBeGreaterThanOrEqual(0);
      if (buy > 0) {
        expect(sell).toBeLessThan(buy);
      }
    }
    expect(itemBuyPrice(requireItem('small_hp_potion'))).toBe(15);
    expect(itemSellPrice(requireItem('slime_gel'))).toBe(4);
    expect(STARTER_GOLD).toBeGreaterThan(0);
  });

  it('computes unit totals and rejects impossible quantities', () => {
    const potion = requireItem('small_hp_potion');
    expect(purchaseCost(potion, 3)).toBe(45);
    expect(saleValue(potion, 3)).toBe(15);

    const armor = requireItem('cloth_armor');
    expect(isShopQuantityAllowed(armor, 1)).toBe(true);
    expect(isShopQuantityAllowed(armor, 2)).toBe(false);
    expect(() => purchaseCost(armor, 2)).toThrow(RangeError);
    expect(isShopQuantityAllowed(potion, 21)).toBe(false);
    expect(isShopQuantityAllowed(potion, 0)).toBe(false);
  });
});
