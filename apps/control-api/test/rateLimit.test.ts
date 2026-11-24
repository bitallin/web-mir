import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '../src/http/rateLimit';

describe('authentication rate limiter', () => {
  it('allows the configured burst and then throttles per key', () => {
    const now = 1_000;
    const take = createRateLimiter({
      capacity: 2,
      refillPerSecond: 1,
      now: () => now,
    });

    expect(take('ip:login')).toBe(true);
    expect(take('ip:login')).toBe(true);
    expect(take('ip:login')).toBe(false);
    expect(take('other:login')).toBe(true);
  });

  it('refills over time without exceeding capacity', () => {
    let now = 0;
    const take = createRateLimiter({
      capacity: 2,
      refillPerSecond: 1,
      now: () => now,
    });

    expect(take('k')).toBe(true);
    expect(take('k')).toBe(true);
    expect(take('k')).toBe(false);

    now = 1_000;
    expect(take('k')).toBe(true);
    expect(take('k')).toBe(false);

    now = 60_000;
    expect(take('k')).toBe(true);
    expect(take('k')).toBe(true);
    expect(take('k')).toBe(false);
  });
});
