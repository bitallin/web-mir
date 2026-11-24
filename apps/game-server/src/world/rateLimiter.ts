export type TokenBucket = {
  take: (nowMs: number) => boolean;
};

export type TokenBucketOptions = {
  capacity: number;
  refillPerSecond: number;
  startMs: number;
};

/**
 * Per-player command budget. Deterministic given the injected timestamps, so
 * rate-limit behaviour is covered by unit tests instead of wall-clock sleeps.
 */
export function createTokenBucket(options: TokenBucketOptions): TokenBucket {
  const { capacity, refillPerSecond, startMs } = options;
  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new RangeError('capacity must be positive');
  }
  if (!Number.isFinite(refillPerSecond) || refillPerSecond <= 0) {
    throw new RangeError('refillPerSecond must be positive');
  }

  let tokens = capacity;
  let lastRefillMs = startMs;

  return {
    take: (nowMs) => {
      if (!Number.isFinite(nowMs) || nowMs < lastRefillMs) {
        throw new RangeError('nowMs must be finite and monotonic');
      }
      const elapsedSeconds = (nowMs - lastRefillMs) / 1_000;
      tokens = Math.min(capacity, tokens + elapsedSeconds * refillPerSecond);
      lastRefillMs = nowMs;

      if (tokens < 1) {
        return false;
      }
      tokens -= 1;
      return true;
    },
  };
}
