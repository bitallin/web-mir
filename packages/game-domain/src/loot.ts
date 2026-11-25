import type { Rng } from './combat';
import { requireItem } from './items';

/**
 * Deterministic loot tables. Each entry consumes exactly two RNG draws (chance
 * and quantity) and gold consumes one, so a seeded test replays the same loot
 * no matter which entries rolled.
 */

export type LootEntry = {
  templateId: string;
  chance: number;
  minQuantity: number;
  maxQuantity: number;
};

export type LootTable = {
  exp: number;
  goldMin: number;
  goldMax: number;
  entries: readonly LootEntry[];
};

export const MONSTER_LOOT_TABLES: Readonly<Record<string, LootTable>> = {
  wild_slime: {
    exp: 12,
    goldMin: 2,
    goldMax: 4,
    entries: [
      { templateId: 'slime_gel', chance: 1, minQuantity: 1, maxQuantity: 2 },
      { templateId: 'small_hp_potion', chance: 0.25, minQuantity: 1, maxQuantity: 1 },
    ],
  },
  forest_wolf: {
    exp: 22,
    goldMin: 5,
    goldMax: 8,
    entries: [
      { templateId: 'wolf_pelt', chance: 1, minQuantity: 1, maxQuantity: 1 },
      { templateId: 'small_mp_potion', chance: 0.2, minQuantity: 1, maxQuantity: 1 },
      { templateId: 'leather_armor', chance: 0.06, minQuantity: 1, maxQuantity: 1 },
    ],
  },
};

export type RolledLootItem = { templateId: string; quantity: number };

export type LootRoll = {
  exp: number;
  gold: number;
  items: RolledLootItem[];
};

export function requireLootTable(monsterTemplateId: string): LootTable {
  const table = MONSTER_LOOT_TABLES[monsterTemplateId];
  if (table === undefined) {
    throw new RangeError(`monster "${monsterTemplateId}" has no loot table`);
  }
  return table;
}

export function rollLoot(table: LootTable, rng: Rng): LootRoll {
  const goldSpan = table.goldMax - table.goldMin;
  const gold = table.goldMin + Math.floor(rng() * (goldSpan + 1));
  const items: RolledLootItem[] = [];

  for (const entry of table.entries) {
    const chanceRoll = rng();
    const quantityRoll = rng();
    if (chanceRoll >= entry.chance) {
      continue;
    }
    const span = entry.maxQuantity - entry.minQuantity;
    const quantity = entry.minQuantity + Math.floor(quantityRoll * (span + 1));
    if (quantity > 0) {
      items.push({ templateId: entry.templateId, quantity });
    }
  }

  return { exp: table.exp, gold, items };
}

function assertLoot(): void {
  for (const [monsterId, table] of Object.entries(MONSTER_LOOT_TABLES)) {
    if (table.exp < 0 || table.goldMin < 0 || table.goldMax < table.goldMin) {
      throw new Error(`loot table "${monsterId}" has invalid exp or gold`);
    }
    for (const entry of table.entries) {
      requireItem(entry.templateId);
      if (entry.chance < 0 || entry.chance > 1) {
        throw new Error(`loot entry "${entry.templateId}" has an invalid chance`);
      }
      if (
        !Number.isInteger(entry.minQuantity) ||
        !Number.isInteger(entry.maxQuantity) ||
        entry.minQuantity < 1 ||
        entry.maxQuantity < entry.minQuantity
      ) {
        throw new Error(`loot entry "${entry.templateId}" has an invalid quantity range`);
      }
    }
  }
}

assertLoot();
