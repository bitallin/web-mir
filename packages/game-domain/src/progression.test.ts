import { describe, expect, it } from 'vitest';

import { MAX_CHARACTER_LEVEL, applyExperience, experienceForNextLevel } from './progression';

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
