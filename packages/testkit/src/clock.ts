export type Clock = {
  now(): number;
};

export type ManualClock = Clock & {
  advance(ms: number): void;
  set(ms: number): void;
};

export function createManualClock(startMs = 0): ManualClock {
  if (!Number.isFinite(startMs)) {
    throw new RangeError('startMs must be finite');
  }

  let current = startMs;

  return {
    now: () => current,
    advance: (ms) => {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new RangeError('advance requires a finite, non-negative duration');
      }
      current += ms;
    },
    set: (ms) => {
      if (!Number.isFinite(ms)) {
        throw new RangeError('set requires a finite timestamp');
      }
      current = ms;
    },
  };
}
