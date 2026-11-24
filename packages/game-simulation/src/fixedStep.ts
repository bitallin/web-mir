export type FixedStepOptions = {
  /** Simulated milliseconds per tick, e.g. 50 for 20Hz. */
  stepMs: number;
  /**
   * Upper bound of ticks performed for one `advance()` call. Prevents a
   * stretched event loop from snowballing into an unbounded catch-up.
   */
  maxCatchUpSteps?: number;
  onStep: (stepMs: number) => void;
};

export type FixedStepRunner = {
  readonly stepMs: number;
  advance(deltaMs: number): number;
};

export function createFixedStepRunner(options: FixedStepOptions): FixedStepRunner {
  const { stepMs, onStep } = options;
  const maxCatchUpSteps = options.maxCatchUpSteps ?? 5;

  if (!Number.isFinite(stepMs) || stepMs <= 0) {
    throw new RangeError('stepMs must be a positive finite number');
  }
  if (!Number.isInteger(maxCatchUpSteps) || maxCatchUpSteps < 1) {
    throw new RangeError('maxCatchUpSteps must be a positive integer');
  }

  let accumulator = 0;

  return {
    stepMs,
    advance: (deltaMs) => {
      if (!Number.isFinite(deltaMs) || deltaMs < 0) {
        throw new RangeError('deltaMs must be a finite, non-negative number');
      }

      accumulator += deltaMs;
      let steps = 0;

      while (accumulator >= stepMs && steps < maxCatchUpSteps) {
        accumulator -= stepMs;
        steps += 1;
        onStep(stepMs);
      }

      if (accumulator >= stepMs) {
        // The process fell far behind; drop the backlog instead of spiraling.
        accumulator = accumulator % stepMs;
      }

      return steps;
    },
  };
}
