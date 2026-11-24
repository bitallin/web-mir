import { TILE_UNITS } from '@web-legend/contracts';

import type { CombatStats } from './stats';

export type Rng = () => number;

export type OffenseStats = {
  attack: number;
  hitChance: number;
  critChance: number;
  critMultiplier: number;
};

export type DefenseStats = {
  defense: number;
  /** Probability in [0, 1] that an incoming attack is avoided. */
  evasion?: number;
};

export type AttackModifier = {
  /** Multiplies the attacker's attack before defense is applied. */
  multiplier: number;
  /** Flat damage added before defense is applied. */
  flatDamage: number;
  canCrit: boolean;
};

export type AttackRoll = {
  hit: boolean;
  critical: boolean;
  /** Always 0 when the attack missed. */
  damage: number;
};

export const BASIC_ATTACK_MODIFIER: AttackModifier = {
  multiplier: 1,
  flatDamage: 0,
  canCrit: true,
};

const MIN_HIT_CHANCE = 0.05;
const MAX_HIT_CHANCE = 0.99;
const MIN_VARIANCE = 0.9;
const MAX_VARIANCE = 1.1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * One attack always consumes exactly three RNG values — hit, critical and
 * damage variance — even when the attack misses. A fixed draw count is what
 * makes a seeded combat replay independent of how many attacks land.
 */
export function rollAttack(
  attacker: OffenseStats,
  defender: DefenseStats,
  rng: Rng,
  modifier: AttackModifier = BASIC_ATTACK_MODIFIER,
): AttackRoll {
  if (modifier.multiplier < 0 || modifier.flatDamage < 0) {
    throw new RangeError('attack modifiers must be non-negative');
  }

  const hitChance = clamp(
    attacker.hitChance - (defender.evasion ?? 0),
    MIN_HIT_CHANCE,
    MAX_HIT_CHANCE,
  );
  const hitRoll = rng();
  const critRoll = rng();
  const varianceRoll = rng();

  const hit = hitRoll < hitChance;
  const critical = hit && modifier.canCrit && critRoll < attacker.critChance;
  if (!hit) {
    return { hit: false, critical: false, damage: 0 };
  }

  const variance = MIN_VARIANCE + varianceRoll * (MAX_VARIANCE - MIN_VARIANCE);
  const raw =
    (attacker.attack * modifier.multiplier + modifier.flatDamage) * variance -
    defender.defense * 0.5;
  let damage = Math.max(1, Math.round(raw));
  if (critical) {
    damage = Math.max(damage + 1, Math.floor(damage * attacker.critMultiplier));
  }

  return { hit: true, critical, damage };
}

export function distanceInTiles(
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  return Math.hypot(from.x - to.x, from.y - to.y) / TILE_UNITS;
}

export function combatStatsAsOffense(stats: CombatStats): OffenseStats {
  return {
    attack: stats.attack,
    hitChance: stats.hitChance,
    critChance: stats.critChance,
    critMultiplier: stats.critMultiplier,
  };
}
