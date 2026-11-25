import { BASE_CONTENT_BUNDLE } from '@web-legend/content-schema/base';
import type {
  CharacterClass,
  ContentBundle,
  ItemContent,
  StarterKitEntry,
} from '@web-legend/contracts';

import type { CombatStats } from './stats';

/**
 * Inventory and equipment rules over a declarative item catalog. The baseline
 * catalog is the phase-5 content moved into `content-schema` (ADR-022).
 */

export type ItemDefinition = ItemContent;
export type ItemCatalog = Readonly<Record<string, ItemContent>>;

export const ITEM_CATALOG: ItemCatalog = BASE_CONTENT_BUNDLE.items;

export type StarterItem = StarterKitEntry;

export const STARTER_KIT: Readonly<Record<CharacterClass, readonly StarterItem[]>> = {
  warrior: BASE_CONTENT_BUNDLE.classes.warrior.starterKit,
  mage: BASE_CONTENT_BUNDLE.classes.mage.starterKit,
  taoist: BASE_CONTENT_BUNDLE.classes.taoist.starterKit,
};

export function starterKitFor(
  classId: CharacterClass,
  content: ContentBundle = BASE_CONTENT_BUNDLE,
): readonly StarterItem[] {
  return content.classes[classId].starterKit;
}

export function requireItem(
  templateId: string,
  catalog: ItemCatalog = ITEM_CATALOG,
): ItemDefinition {
  const item = catalog[templateId];
  if (item === undefined) {
    throw new RangeError(`unknown item "${templateId}"`);
  }
  return item;
}

/** New characters start with this much gold so the first city trip matters. */
export const STARTER_GOLD = 50 as const;

export function itemBuyPrice(definition: ItemDefinition): number {
  return definition.buyPrice ?? 0;
}

export function itemSellPrice(definition: ItemDefinition): number {
  return definition.sellPrice ?? 0;
}

/** Whether one merchant command may move this many units of the template. */
export function isShopQuantityAllowed(definition: ItemDefinition, quantity: number): boolean {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return false;
  }
  return definition.stackable ? quantity <= definition.maxStack : quantity === 1;
}

export function purchaseCost(definition: ItemDefinition, quantity: number): number {
  if (!isShopQuantityAllowed(definition, quantity)) {
    throw new RangeError(`invalid purchase quantity ${String(quantity)}`);
  }
  const total = itemBuyPrice(definition) * quantity;
  if (!Number.isSafeInteger(total)) {
    throw new RangeError('purchase cost is not a safe integer');
  }
  return total;
}

export function saleValue(definition: ItemDefinition, quantity: number): number {
  if (!isShopQuantityAllowed(definition, quantity)) {
    throw new RangeError(`invalid sale quantity ${String(quantity)}`);
  }
  const total = itemSellPrice(definition) * quantity;
  if (!Number.isSafeInteger(total)) {
    throw new RangeError('sale value is not a safe integer');
  }
  return total;
}

export function canEquip(
  definition: ItemDefinition,
  classId: CharacterClass,
  level: number,
): 'ok' | 'notEquippable' | 'wrongClass' | 'levelTooLow' {
  if (definition.equipSlot === undefined) {
    return 'notEquippable';
  }
  if (definition.classId !== undefined && definition.classId !== classId) {
    return 'wrongClass';
  }
  if (level < definition.levelRequirement) {
    return 'levelTooLow';
  }
  return 'ok';
}

export function isConsumable(definition: ItemDefinition): boolean {
  return definition.kind === 'consumable' && (definition.healHp > 0 || definition.healMp > 0);
}

export type EquippedItem = ItemDefinition;

export type EquipmentBonuses = {
  attack: number;
  defense: number;
  maxHp: number;
  maxMp: number;
};

export function equipmentBonuses(
  equipped: readonly (EquippedItem | undefined)[],
): EquipmentBonuses {
  const bonuses: EquipmentBonuses = { attack: 0, defense: 0, maxHp: 0, maxMp: 0 };
  for (const item of equipped) {
    if (item === undefined) {
      continue;
    }
    bonuses.attack += item.attackBonus;
    bonuses.defense += item.defenseBonus;
    bonuses.maxHp += item.maxHpBonus;
    bonuses.maxMp += item.maxMpBonus;
  }
  return bonuses;
}

/** Applies equipment on top of the class/level baseline; never the reverse. */
export function statsWithEquipment(stats: CombatStats, bonuses: EquipmentBonuses): CombatStats {
  return {
    ...stats,
    maxHp: stats.maxHp + bonuses.maxHp,
    maxMp: stats.maxMp + bonuses.maxMp,
    attack: stats.attack + bonuses.attack,
    defense: stats.defense + bonuses.defense,
  };
}

export type InventoryStack = {
  itemId: string;
  templateId: string;
  quantity: number;
  slotIndex: number;
};

export type InventoryPlacement =
  | { kind: 'merge'; targetItemId: string; resultingQuantity: number }
  | { kind: 'slot'; slotIndex: number };

/**
 * Pure placement rule shared by pickup and starter-kit provisioning. An item
 * that cannot fit produces `null`; the transaction then rolls back so the drop
 * stays on the ground.
 */
export function findInventoryPlacement(
  input: {
    items: readonly InventoryStack[];
    templateId: string;
    quantity: number;
    capacity: number;
  },
  catalog: ItemCatalog = ITEM_CATALOG,
): InventoryPlacement | null {
  const definition = requireItem(input.templateId, catalog);
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new RangeError('item quantity must be a positive integer');
  }
  if (input.capacity < 1) {
    throw new RangeError('inventory capacity must be positive');
  }
  if (input.quantity > definition.maxStack) {
    return null;
  }

  if (definition.stackable) {
    const candidates = input.items
      .filter(
        (item) =>
          item.templateId === input.templateId &&
          item.quantity + input.quantity <= definition.maxStack,
      )
      .sort((left, right) => left.slotIndex - right.slotIndex);
    const target = candidates[0];
    if (target !== undefined) {
      return {
        kind: 'merge',
        targetItemId: target.itemId,
        resultingQuantity: target.quantity + input.quantity,
      };
    }
  }

  const used = new Set(input.items.map((item) => item.slotIndex));
  for (let slot = 0; slot < input.capacity; slot += 1) {
    if (!used.has(slot)) {
      return { kind: 'slot', slotIndex: slot };
    }
  }
  return null;
}
