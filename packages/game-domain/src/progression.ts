import type { DeathPenaltyRule } from '@web-legend/contracts';

import { MAX_COMBAT_LEVEL } from './stats';

/**
 * Level curve for the MVP. Experience is only ever gained by the server's
 * kill-reward transaction; the client never computes a level or a threshold.
 */
export const MAX_CHARACTER_LEVEL = MAX_COMBAT_LEVEL;

export function experienceForNextLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > MAX_CHARACTER_LEVEL) {
    throw new RangeError(`level must be an integer in [1, ${String(MAX_CHARACTER_LEVEL)}]`);
  }
  if (level >= MAX_CHARACTER_LEVEL) {
    return 0;
  }
  return 30 * level;
}

export type ExperienceResult = {
  level: number;
  exp: number;
  levelsGained: number;
};

export function applyExperience(level: number, exp: number, gained: number): ExperienceResult {
  if (!Number.isInteger(exp) || exp < 0) {
    throw new RangeError('experience must be a non-negative integer');
  }
  if (!Number.isInteger(gained) || gained < 0) {
    throw new RangeError('gained experience must be a non-negative integer');
  }

  let nextLevel = level;
  let nextExp = exp + gained;
  let levelsGained = 0;

  while (nextLevel < MAX_CHARACTER_LEVEL) {
    const threshold = experienceForNextLevel(nextLevel);
    if (nextExp < threshold) {
      break;
    }
    nextExp -= threshold;
    nextLevel += 1;
    levelsGained += 1;
  }

  if (nextLevel >= MAX_CHARACTER_LEVEL) {
    nextExp = 0;
  }

  return { level: nextLevel, exp: nextExp, levelsGained };
}

export type DeathPenaltyResult = {
  level: number;
  exp: number;
  lost: number;
};

/**
 * Experience sacrificed by a PvE death: a share of the progress inside the
 * current level. The level itself never drops (ADR-031), so a death can only
 * erase progress, never undo a level-up. Characters below the content rule's
 * protection level lose nothing.
 */
export function applyDeathPenalty(
  level: number,
  exp: number,
  rule: DeathPenaltyRule,
): DeathPenaltyResult {
  if (!Number.isInteger(level) || level < 1 || level > MAX_CHARACTER_LEVEL) {
    throw new RangeError(`level must be an integer in [1, ${String(MAX_CHARACTER_LEVEL)}]`);
  }
  if (!Number.isInteger(exp) || exp < 0) {
    throw new RangeError('experience must be a non-negative integer');
  }
  if (level < rule.protectBelowLevel || rule.xpLossPermille <= 0 || exp === 0) {
    return { level, exp, lost: 0 };
  }
  const lost = Math.floor((exp * rule.xpLossPermille) / 1_000);
  return { level, exp: exp - lost, lost };
}
