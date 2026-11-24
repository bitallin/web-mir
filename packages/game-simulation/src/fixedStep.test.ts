import { describe, expect, it } from 'vitest';

import { createFixedStepRunner } from './fixedStep';

describe('createFixedStepRunner', () => {
  it('accumulates partial deltas into whole fixed steps', () => {
    const steps: number[] = [];
    const runner = createFixedStepRunner({
      stepMs: 50,
      onStep: (stepMs) => steps.push(stepMs),
    });

    expect(runner.advance(25)).toBe(0);
    expect(runner.advance(25)).toBe(1);
    expect(runner.advance(120)).toBe(2);
    expect(steps).toEqual([50, 50, 50]);
  });

  it('keeps a 20Hz cadence across jittery deltas', () => {
    const runner = createFixedStepRunner({ stepMs: 50, onStep: () => undefined });
    let steps = 0;
    const deltas = [47, 53, 48, 52, 50, 46, 54, 49, 51, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
    for (const delta of deltas) {
      steps += runner.advance(delta);
    }

    expect(steps).toBe(20);
  });

  it('caps catch-up work so a stalled loop cannot snowball', () => {
    let steps = 0;
    const runner = createFixedStepRunner({
      stepMs: 50,
      maxCatchUpSteps: 3,
      onStep: () => {
        steps += 1;
      },
    });

    expect(runner.advance(5_000)).toBe(3);
    expect(steps).toBe(3);
    expect(runner.advance(10)).toBe(0);
  });

  it('rejects invalid configuration and deltas', () => {
    expect(() => createFixedStepRunner({ stepMs: 0, onStep: () => undefined })).toThrow(RangeError);
    expect(() =>
      createFixedStepRunner({ stepMs: 50, maxCatchUpSteps: 0, onStep: () => undefined }),
    ).toThrow(RangeError);

    const runner = createFixedStepRunner({ stepMs: 50, onStep: () => undefined });
    expect(() => runner.advance(-1)).toThrow(RangeError);
    expect(() => runner.advance(Number.NaN)).toThrow(RangeError);
  });
});
