import { describe, expect, it } from 'vitest';

import { distanceInTiles, rollAttack } from './combat';

function sequenceRng(values: readonly number[]): { rng: () => number; calls: () => number } {
  let index = 0;
  let calls = 0;
  return {
    rng: () => {
      calls += 1;
      const value = values[index] ?? 0;
      index += 1;
      return value;
    },
    calls: () => calls,
  };
}

const attacker = {
  attack: 10,
  hitChance: 1,
  critChance: 0,
  critMultiplier: 1.75,
};

const defender = { defense: 0 };

describe('rollAttack', () => {
  it('produces base damage with neutral variance', () => {
    const { rng } = sequenceRng([0, 0.5, 0.5]);
    expect(rollAttack(attacker, defender, rng)).toEqual({
      hit: true,
      critical: false,
      damage: 10,
    });
  });

  it('applies the critical multiplier after variance', () => {
    const { rng } = sequenceRng([0, 0, 0.5]);
    expect(rollAttack({ ...attacker, critChance: 1 }, defender, rng)).toEqual({
      hit: true,
      critical: true,
      damage: 17,
    });
  });

  it('reduces damage by half of the defender defense with a floor of one', () => {
    const neutral = sequenceRng([0, 0.5, 0.5]);
    expect(rollAttack(attacker, { defense: 10 }, neutral.rng).damage).toBe(5);

    const weak = sequenceRng([0, 0.5, 0.5]);
    expect(rollAttack({ ...attacker, attack: 1 }, { defense: 100 }, weak.rng).damage).toBe(1);
  });

  it('consumes exactly three random values even when the attack misses', () => {
    const { rng, calls } = sequenceRng([0.99, 0, 0.5]);
    const result = rollAttack({ ...attacker, hitChance: 0.5 }, defender, rng);
    expect(result).toEqual({ hit: false, critical: false, damage: 0 });
    expect(calls()).toBe(3);
  });

  it('applies skill multipliers and flat damage before defense', () => {
    const { rng } = sequenceRng([0, 0.5, 0.5]);
    const result = rollAttack(attacker, { defense: 4 }, rng, {
      multiplier: 2,
      flatDamage: 4,
      canCrit: false,
    });
    expect(result.damage).toBe(22);
  });
});

describe('distanceInTiles', () => {
  it('measures unit positions in tile units', () => {
    expect(distanceInTiles({ x: 0, y: 0 }, { x: 3_000, y: 4_000 })).toBe(5);
    expect(distanceInTiles({ x: 1_500, y: 1_500 }, { x: 1_500, y: 1_500 })).toBe(0);
  });
});
