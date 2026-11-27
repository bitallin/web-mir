import { BASE_CONTENT_BUNDLE } from '@web-legend/content-schema/base';
import type { LootEntryContent, LootTableContent } from '@web-legend/contracts';

import type { Rng } from './combat';

/**
 * Deterministic loot tables. Each entry consumes exactly two RNG draws (chance
 * and quantity) and gold consumes one, so a seeded test replays the same loot
 * no matter which entries rolled. Table data comes from the Room's fixed
 * content release (ADR-022).
 */

export type LootEntry = LootEntryContent;
export type LootTable = LootTableContent;
export type LootTables = Readonly<Record<string, LootTableContent>>;

export const MONSTER_LOOT_TABLES: LootTables = BASE_CONTENT_BUNDLE.lootTables;

export type RolledLootItem = {
  templateId: string;
  quantity: number;
  /** Unowned, locked and hand-picked only (ADR-041). */
  contested?: boolean;
};

export type LootRoll = {
  exp: number;
  gold: number;
  items: RolledLootItem[];
};

export function requireLootTable(
  monsterTemplateId: string,
  tables: LootTables = MONSTER_LOOT_TABLES,
): LootTable {
  const table = tables[monsterTemplateId];
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
      items.push({
        templateId: entry.templateId,
        quantity,
        ...(entry.contested === true ? { contested: true } : {}),
      });
    }
  }

  return { exp: table.exp, gold, items };
}
