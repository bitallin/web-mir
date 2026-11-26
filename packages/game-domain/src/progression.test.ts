import { describe, expect, it } from 'vitest';

import {
  MAX_CHARACTER_LEVEL,
  applyDeathPenalty,
  applyExperience,
  experienceForNextLevel,
} from './progression';

describe('experience progression', () => {
  it('uses a rising threshold and stops at the level cap', () => {
    expect(experienceForNextLevel(1)).toBe(30);
    expect(experienceForNextLevel(2)).toBe(60);
    expect(experienceForNextLevel(MAX_CHARACTER_LEVEL)).toBe(0);
    expect(() => experienceForNextLevel(0)).toThrow(RangeError);
  });

  it('levels up once when the threshold is crossed', () => {
    expect(applyExperience(1, 10, 12)).toEqual({ level: 1, exp: 22, levelsGained: 0 });
    expect(applyExperience(1, 25, 12)).toEqual({ level: 2, exp: 7, levelsGained: 1 });
  });

  it('applies multiple level ups in order', () => {
    // L1 needs 30, L2 needs 60; 100 experience reaches level 3 with 10 left.
    expect(applyExperience(1, 0, 100)).toEqual({ level: 3, exp: 10, levelsGained: 2 });
  });

  it('caps experience at the maximum level', () => {
    expect(applyExperience(MAX_CHARACTER_LEVEL, 0, 1_000)).toEqual({
      level: MAX_CHARACTER_LEVEL,
      exp: 0,
      levelsGained: 0,
    });
  });

  it('rejects invalid input', () => {
    expect(() => applyExperience(1, -1, 5)).toThrow(RangeError);
    expect(() => applyExperience(1, 0, -5)).toThrow(RangeError);
  });
});

describe('death penalty', () => {
  const rule = { xpLossPermille: 100, protectBelowLevel: 10 };

  it('takes a share of the progress inside the current level', () => {
    expect(applyDeathPenalty(10, 200, rule)).toEqual({ level: 10, exp: 180, lost: 20 });
    expect(applyDeathPenalty(12, 75, rule)).toEqual({ level: 12, exp: 68, lost: 7 });
  });

  it('never delevels or goes negative', () => {
    expect(applyDeathPenalty(20, 5, { xpLossPermille: 1_000, protectBelowLevel: 1 })).toEqual({
      level: 20,
      exp: 0,
      lost: 5,
    });
    expect(applyDeathPenalty(20, 0, rule)).toEqual({ level: 20, exp: 0, lost: 0 });
  });

  it('protects characters below the content threshold', () => {
    expect(applyDeathPenalty(9, 200, rule)).toEqual({ level: 9, exp: 200, lost: 0 });
    expect(applyDeathPenalty(10, 200, rule).lost).toBe(20);
  });

  it('honours a disabled penalty and rejects invalid progress', () => {
    expect(applyDeathPenalty(15, 200, { xpLossPermille: 0, protectBelowLevel: 1 })).toEqual({
      level: 15,
      exp: 200,
      lost: 0,
    });
    expect(() => applyDeathPenalty(15, -1, rule)).toThrow(RangeError);
    expect(() => applyDeathPenalty(0, 10, rule)).toThrow(RangeError);
  });
});
