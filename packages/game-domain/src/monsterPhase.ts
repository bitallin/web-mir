import type { MonsterContent } from '@web-legend/contracts';

/**
 * Effective monster attributes for its current life. Enrage is a content
 * phase (ADR-037): every absent multiplier keeps the base value, so a release
 * that predates the field behaves exactly as before.
 */
export type MonsterPhaseStats = {
  attack: number;
  attackIntervalMs: number;
  moveSpeedUnitsPerSecond: number;
  windupRadiusTiles: number;
};

export function monsterStatsAtPhase(
  definition: MonsterContent,
  enraged: boolean,
): MonsterPhaseStats {
  const enrage = enraged ? definition.enrage : undefined;
  return {
    attack:
      enrage?.attackMultiplier === undefined
        ? definition.attack
        : Math.round(definition.attack * enrage.attackMultiplier),
    attackIntervalMs:
      enrage?.attackIntervalMultiplier === undefined
        ? definition.attackIntervalMs
        : Math.max(100, Math.round(definition.attackIntervalMs * enrage.attackIntervalMultiplier)),
    moveSpeedUnitsPerSecond:
      enrage?.moveSpeedMultiplier === undefined
        ? definition.moveSpeedUnitsPerSecond
        : Math.round(definition.moveSpeedUnitsPerSecond * enrage.moveSpeedMultiplier),
    windupRadiusTiles: enrage?.windupRadiusTiles ?? definition.windupRadiusTiles ?? 1.5,
  };
}
