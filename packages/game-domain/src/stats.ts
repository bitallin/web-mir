import { BASE_CONTENT_BUNDLE } from '@web-legend/content-schema/base';
import type { CharacterClass, ContentBundle } from '@web-legend/contracts';

/**
 * Server-authoritative combat attributes derived from class content and level.
 * Equipment is added on top by the application service; clients never compute
 * this. The bundle is fixed per Room (ADR-022).
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
  /** Mana restored per second while alive; content-driven, never client-set. */
  mpRegenPerSecond: number;
};

export const MAX_COMBAT_LEVEL = 100 as const;

export function combatStatsFor(
  classId: CharacterClass,
  level: number,
  content: ContentBundle = BASE_CONTENT_BUNDLE,
): CombatStats {
  if (!Number.isInteger(level) || level < 1 || level > MAX_COMBAT_LEVEL) {
    throw new RangeError(`combat level must be an integer in [1, ${String(MAX_COMBAT_LEVEL)}]`);
  }
  const definition = content.classes[classId];
  const levels = level - 1;

  return {
    classId,
    level,
    maxHp: Math.floor(definition.baseMaxHp + definition.hpPerLevel * levels),
    maxMp: Math.floor(definition.baseMaxMp + definition.mpPerLevel * levels),
    attack: Math.floor(definition.baseAttack + definition.attackPerLevel * levels),
    defense: Math.floor(definition.baseDefense + definition.defensePerLevel * levels),
    hitChance: definition.hitChance,
    critChance: definition.critChance,
    critMultiplier: definition.critMultiplier,
    attackIntervalMs: definition.attackIntervalMs,
    attackRangeTiles: definition.attackRangeTiles,
    mpRegenPerSecond: definition.mpRegenPerSecond ?? 0,
  };
}
