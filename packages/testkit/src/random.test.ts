import { describe, expect, it } from 'vitest';

import { createSeededRng, rollInt } from './random';

describe('createSeededRng', () => {
  it('is deterministic for the same seed', () => {
    const first = createSeededRng('loot-seed');
    const second = createSeededRng('loot-seed');

    const firstValues = Array.from({ length: 8 }, () => first());
    const secondValues = Array.from({ length: 8 }, () => second());

    expect(firstValues).toEqual(secondValues);
  });

  it('produces different streams for different seeds', () => {
    const first = createSeededRng('seed-a');
    const second = createSeededRng('seed-b');

    expect(first()).not.toBe(second());
  });

  it('stays within [0, 1)', () => {
    const rng = createSeededRng(42);
    for (let index = 0; index < 1_000; index += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('rollInt', () => {
  it('returns integers within the inclusive range', () => {
    const rng = createSeededRng('drops');
    for (let index = 0; index < 500; index += 1) {
      const value = rollInt(rng, 3, 7);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
    }
  });

  it('rejects invalid bounds', () => {
    const rng = createSeededRng(1);
    expect(() => rollInt(rng, 5, 4)).toThrow(RangeError);
    expect(() => rollInt(rng, 1.5, 4)).toThrow(RangeError);
  });
});
