import { randomBytes } from 'node:crypto';

/**
 * Production combat RNG. It is seeded from the operating system, never from
 * client input, so damage/crit rolls cannot be predicted or replayed by a
 * client. Tests inject a deterministic function through room options instead.
 */
export function createCombatRng(): () => number {
  const pool: number[] = [];
  return () => {
    const cached = pool.pop();
    if (cached !== undefined) {
      return cached;
    }
    const bytes = randomBytes(256);
    for (let offset = 0; offset < bytes.length; offset += 4) {
      pool.push(bytes.readUInt32LE(offset) / 4_294_967_296);
    }
    return pool.pop() ?? 0.5;
  };
}
