import { CHARACTER_CLASS_CATALOG, type CharacterClass } from '@web-legend/contracts';

/**
 * Server-authoritative combat attributes derived from class and level. Phase 5
 * adds equipment and buffs on top of this base; clients never compute it.
 */
export type CombatStats = {
  classId: CharacterClass;
  level: number;
  maxHp: number;
  maxMp: number;
  attack: number;
  defense: number;
  /** Probability in [0, 1]. */
  hitChance: number;
  /** Probability in [0, 1]. */
  critChance: number;
  critMultiplier: number;
  attackIntervalMs: number;
  attackRangeTiles: number;
};

type Growth = {
  hpPerLevel: number;
  mpPerLevel: number;
  attackPerLevel: number;
  defensePerLevel: number;
  hitChance: number;
  critChance: number;
  critMultiplier: number;
  attackIntervalMs: number;
  attackRangeTiles: number;
};

const GROWTH: Record<CharacterClass, Growth> = {
  warrior: {
    hpPerLevel: 18,
    mpPerLevel: 3,
    attackPerLevel: 2,
    defensePerLevel: 1,
    hitChance: 0.92,
    critChance: 0.08,
    critMultiplier: 1.75,
    attackIntervalMs: 900,
    attackRangeTiles: 1.4,
  },
  mage: {
    hpPerLevel: 10,
    mpPerLevel: 8,
    attackPerLevel: 3,
    defensePerLevel: 0.5,
    hitChance: 0.88,
    critChance: 0.1,
    critMultiplier: 1.8,
    attackIntervalMs: 1_200,
    attackRangeTiles: 5.5,
  },
  taoist: {
    hpPerLevel: 14,
    mpPerLevel: 6,
    attackPerLevel: 2,
    defensePerLevel: 1,
    hitChance: 0.9,
    critChance: 0.06,
    critMultiplier: 1.7,
    attackIntervalMs: 1_000,
    attackRangeTiles: 3.5,
  },
};

export const MAX_COMBAT_LEVEL = 100 as const;

export function combatStatsFor(classId: CharacterClass, level: number): CombatStats {
  if (!Number.isInteger(level) || level < 1 || level > MAX_COMBAT_LEVEL) {
    throw new RangeError(`combat level must be an integer in [1, ${String(MAX_COMBAT_LEVEL)}]`);
  }
  const base = CHARACTER_CLASS_CATALOG[classId];
  const growth = GROWTH[classId];
  const levels = level - 1;

  return {
    classId,
    level,
    maxHp: Math.floor(base.baseMaxHp + growth.hpPerLevel * levels),
    maxMp: Math.floor(base.baseMaxMp + growth.mpPerLevel * levels),
    attack: Math.floor(base.baseAttack + growth.attackPerLevel * levels),
    defense: Math.floor(base.baseDefense + growth.defensePerLevel * levels),
    hitChance: growth.hitChance,
    critChance: growth.critChance,
    critMultiplier: growth.critMultiplier,
    attackIntervalMs: growth.attackIntervalMs,
    attackRangeTiles: growth.attackRangeTiles,
  };
}
