export type TokenBucket = {
  tokens: number;
  updatedAtMs: number;
};

export type RateLimiterOptions = {
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
};

/**
 * In-memory token bucket for authentication endpoints (single control-api
 * process). Returns false when the caller must be throttled.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const now = options.now ?? Date.now;
  const buckets = new Map<string, TokenBucket>();

  return function take(key: string): boolean {
    const currentMs = now();
    const existing = buckets.get(key) ?? {
      tokens: options.capacity,
      updatedAtMs: currentMs,
    };

    const elapsedSeconds = Math.max(0, currentMs - existing.updatedAtMs) / 1_000;
    const tokens = Math.min(
      options.capacity,
      existing.tokens + elapsedSeconds * options.refillPerSecond,
    );

    if (tokens < 1) {
      existing.tokens = tokens;
      existing.updatedAtMs = currentMs;
      buckets.set(key, existing);
      return false;
    }

    existing.tokens = tokens - 1;
    existing.updatedAtMs = currentMs;
    buckets.set(key, existing);
    return true;
  };
}
