import { describe, expect, it } from 'vitest';

import { createTokenBucket } from './rateLimiter';

describe('createTokenBucket', () => {
  it('allows a burst up to capacity and then refuses', () => {
    const bucket = createTokenBucket({ capacity: 3, refillPerSecond: 10, startMs: 0 });

    expect(bucket.take(0)).toBe(true);
    expect(bucket.take(0)).toBe(true);
    expect(bucket.take(0)).toBe(true);
    expect(bucket.take(0)).toBe(false);
  });

  it('refills over time and never exceeds capacity', () => {
    const bucket = createTokenBucket({ capacity: 2, refillPerSecond: 10, startMs: 0 });

    expect(bucket.take(0)).toBe(true);
    expect(bucket.take(0)).toBe(true);
    expect(bucket.take(0)).toBe(false);
    expect(bucket.take(100)).toBe(true);
    expect(bucket.take(100)).toBe(false);
    expect(bucket.take(10_000)).toBe(true);
    expect(bucket.take(10_000)).toBe(true);
    expect(bucket.take(10_000)).toBe(false);
  });

  it('rejects invalid configuration and non-monotonic time', () => {
    expect(() => createTokenBucket({ capacity: 0, refillPerSecond: 1, startMs: 0 })).toThrow(
      RangeError,
    );
    expect(() => createTokenBucket({ capacity: 1, refillPerSecond: 0, startMs: 0 })).toThrow(
      RangeError,
    );

    const bucket = createTokenBucket({ capacity: 1, refillPerSecond: 1, startMs: 100 });
    expect(() => bucket.take(99)).toThrow(RangeError);
  });
});
