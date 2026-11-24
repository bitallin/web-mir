import { describe, expect, it } from 'vitest';

import { createManualClock } from './clock';

describe('createManualClock', () => {
  it('starts at the requested time and advances explicitly', () => {
    const clock = createManualClock(1_000);

    expect(clock.now()).toBe(1_000);
    clock.advance(50);
    expect(clock.now()).toBe(1_050);
    clock.set(2_000);
    expect(clock.now()).toBe(2_000);
  });

  it('rejects negative or non-finite advances', () => {
    const clock = createManualClock();
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError);
    expect(() => createManualClock(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
