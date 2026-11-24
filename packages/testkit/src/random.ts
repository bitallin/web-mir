export type Rng = () => number;

function hashString(value: string): number {
  let hash = 1_779_033_703 ^ value.length;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3_432_918_353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * Deterministic, seedable PRNG (mulberry32). Server-side random outcomes must
 * come from an injected RNG so tests can replay exact sequences.
 */
export function createSeededRng(seed: number | string): Rng {
  let state = (typeof seed === 'number' ? seed : hashString(seed)) >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Uniform integer in [min, maxInclusive]. */
export function rollInt(rng: Rng, min: number, maxInclusive: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(maxInclusive) || maxInclusive < min) {
    throw new RangeError('rollInt requires integer bounds with maxInclusive >= min');
  }
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}
