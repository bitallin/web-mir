import type { CharacterClass, EquipmentSlot, ItemKind } from '@web-legend/contracts';

import type { CombatStats } from './stats';

/**
 * Fixed phase-5 item catalog. IDs are stable and referenced by persisted
 * `item_instances.template_id`; phase 7 moves the numbers into Content
 * Releases, but the behaviour handlers stay in code (ADR-011 / ADR-020).
 */

export type ItemDefinition = {
  id: string;
  name: string;
  kind: ItemKind;
  equipSlot?: EquipmentSlot;
  /** Undefined means every class may equip it. */
  classId?: CharacterClass;
  levelRequirement: number;
  stackable: boolean;
  maxStack: number;
  attackBonus: number;
  defenseBonus: number;
  maxHpBonus: number;
  maxMpBonus: number;
  healHp: number;
  healMp: number;
};

const NO_BONUS = {
  attackBonus: 0,
  defenseBonus: 0,
  maxHpBonus: 0,
  maxMpBonus: 0,
  healHp: 0,
  healMp: 0,
} as const;

export const ITEM_CATALOG: Readonly<Record<string, ItemDefinition>> = {
  warrior_sword: {
    id: 'warrior_sword',
    name: '铁剑',
    kind: 'weapon',
    equipSlot: 'weapon',
    classId: 'warrior',
    levelRequirement: 1,
    stackable: false,
    maxStack: 1,
    ...NO_BONUS,
    attackBonus: 6,
  },
  mage_staff: {
    id: 'mage_staff',
    name: '灵木杖',
    kind: 'weapon',
    equipSlot: 'weapon',
    classId: 'mage',
    levelRequirement: 1,
    stackable: false,
    maxStack: 1,
    ...NO_BONUS,
    attackBonus: 7,
  },
  taoist_blade: {
    id: 'taoist_blade',
    name: '青锋剑',
    kind: 'weapon',
    equipSlot: 'weapon',
    classId: 'taoist',
    levelRequirement: 1,
    stackable: false,
    maxStack: 1,
    ...NO_BONUS,
    attackBonus: 5,
    maxMpBonus: 10,
  },
  cloth_armor: {
    id: 'cloth_armor',
    name: '布衣',
    kind: 'armor',
    equipSlot: 'armor',
    levelRequirement: 1,
    stackable: false,
    maxStack: 1,
    ...NO_BONUS,
    defenseBonus: 2,
  },
  leather_armor: {
    id: 'leather_armor',
    name: '皮甲',
    kind: 'armor',
    equipSlot: 'armor',
    levelRequirement: 3,
    stackable: false,
    maxStack: 1,
    ...NO_BONUS,
    defenseBonus: 5,
    maxHpBonus: 15,
  },
  small_hp_potion: {
    id: 'small_hp_potion',
    name: '金创药',
    kind: 'consumable',
    levelRequirement: 1,
    stackable: true,
    maxStack: 20,
    ...NO_BONUS,
    healHp: 40,
  },
  small_mp_potion: {
    id: 'small_mp_potion',
    name: '魔法药',
    kind: 'consumable',
    levelRequirement: 1,
    stackable: true,
    maxStack: 20,
    ...NO_BONUS,
    healMp: 30,
  },
  slime_gel: {
    id: 'slime_gel',
    name: '史莱姆凝胶',
    kind: 'material',
    levelRequirement: 1,
    stackable: true,
    maxStack: 50,
    ...NO_BONUS,
  },
  wolf_pelt: {
    id: 'wolf_pelt',
    name: '狼皮',
    kind: 'material',
    levelRequirement: 1,
    stackable: true,
    maxStack: 50,
    ...NO_BONUS,
  },
};

export type StarterItem = { templateId: string; quantity: number };

/** New characters spawn with a class weapon and a few potions. */
export const STARTER_KIT: Readonly<Record<CharacterClass, readonly StarterItem[]>> = {
  warrior: [
    { templateId: 'warrior_sword', quantity: 1 },
    { templateId: 'small_hp_potion', quantity: 3 },
    { templateId: 'small_mp_potion', quantity: 1 },
  ],
  mage: [
    { templateId: 'mage_staff', quantity: 1 },
    { templateId: 'small_hp_potion', quantity: 2 },
    { templateId: 'small_mp_potion', quantity: 3 },
  ],
  taoist: [
    { templateId: 'taoist_blade', quantity: 1 },
    { templateId: 'small_hp_potion', quantity: 2 },
    { templateId: 'small_mp_potion', quantity: 2 },
  ],
};

export function requireItem(templateId: string): ItemDefinition {
  const item = ITEM_CATALOG[templateId];
  if (item === undefined) {
    throw new RangeError(`unknown item "${templateId}"`);
  }
  return item;
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
export function findInventoryPlacement(input: {
  items: readonly InventoryStack[];
  templateId: string;
  quantity: number;
  capacity: number;
}): InventoryPlacement | null {
  const definition = requireItem(input.templateId);
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
