import { CHARACTER_CLASS_CATALOG, CHARACTER_CLASSES } from '@web-legend/contracts';
import { describe, expect, it } from 'vitest';

import { combatStatsFor } from './stats';

describe('combatStatsFor', () => {
  it('starts every class at its catalog base attributes', () => {
    for (const classId of CHARACTER_CLASSES) {
      const stats = combatStatsFor(classId, 1);
      const base = CHARACTER_CLASS_CATALOG[classId];
      expect(stats.maxHp).toBe(base.baseMaxHp);
      expect(stats.maxMp).toBe(base.baseMaxMp);
      expect(stats.attack).toBe(base.baseAttack);
      expect(stats.defense).toBe(base.baseDefense);
      expect(Number.isInteger(stats.defense)).toBe(true);
    }
  });

  it('grows HP, MP, attack and defense with level', () => {
    const levelOne = combatStatsFor('warrior', 1);
    const levelFive = combatStatsFor('warrior', 5);
    expect(levelFive.maxHp).toBe(levelOne.maxHp + 18 * 4);
    expect(levelFive.maxMp).toBe(levelOne.maxMp + 3 * 4);
    expect(levelFive.attack).toBe(levelOne.attack + 2 * 4);
    expect(levelFive.defense).toBe(levelOne.defense + 1 * 4);
  });

  it('rejects invalid levels instead of clamping silently', () => {
    expect(() => combatStatsFor('warrior', 0)).toThrow(RangeError);
    expect(() => combatStatsFor('warrior', 1.5)).toThrow(RangeError);
    expect(() => combatStatsFor('warrior', 101)).toThrow(RangeError);
  });
});
