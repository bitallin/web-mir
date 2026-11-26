import { describe, expect, it } from 'vitest';

import { MONSTER_LOOT_TABLES, requireLootTable, rollLoot } from './loot';

function sequenceRng(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error('RNG sequence exhausted');
    }
    index += 1;
    return value;
  };
}

describe('loot tables', () => {
  it('defines a table for every monster with valid references', () => {
    expect(Object.keys(MONSTER_LOOT_TABLES).sort()).toEqual([
      'alpha_wolf',
      'corrupt_warlock',
      'forest_wolf',
      'ruin_gargoyle',
      'skeleton_warrior',
      'stone_guard',
      'venom_spider',
      'wild_slime',
    ]);
    expect(() => requireLootTable('missing_monster')).toThrow(RangeError);
    expect(requireLootTable('wild_slime').exp).toBeGreaterThan(0);
    expect(requireLootTable('alpha_wolf').exp).toBeGreaterThan(requireLootTable('wild_slime').exp);
  });

  it('rolls gold and every entry with a fixed number of draws', () => {
    const table = requireLootTable('wild_slime');
    // Gold, then (chance, quantity) for each of the two entries.
    const rng = sequenceRng([0.5, 0.1, 0.9, 0.9, 0.0]);
    const roll = rollLoot(table, rng);
    const draws = 1 + table.entries.length * 2;

    expect(draws).toBe(5);
    expect(roll.gold).toBe(3);
    expect(roll.exp).toBe(12);
    // Guaranteed gel rolled 0.1 -> quantity 1..2 with 0.9 -> 2; the potion
    // chance 0.9 misses its 0.25 threshold.
    expect(roll.items).toEqual([{ templateId: 'slime_gel', quantity: 2 }]);
  });

  it('drops guaranteed entries even when the chance roll is zero', () => {
    const table = requireLootTable('forest_wolf');
    // Gold roll 0, then every optional entry misses its chance.
    const rng = sequenceRng([0, ...table.entries.flatMap(() => [0.99, 0])]);
    const roll = rollLoot(table, rng);
    expect(roll.items).toEqual([{ templateId: 'wolf_pelt', quantity: 1 }]);
  });

  it('replays identically for the same seed', () => {
    let seed = 7;
    const seeded = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const table = requireLootTable('forest_wolf');
    const first = rollLoot(table, seeded);
    seed = 7;
    const second = rollLoot(table, seeded);
    expect(second).toEqual(first);
  });
});
