import { describe, expect, it } from 'vitest';

import { createUuid } from './uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createUuid', () => {
  it('returns a v4 uuid from the secure-context API when available', () => {
    expect(createUuid({ randomUUID: () => 'fixed-uuid' })).toBe('fixed-uuid');
  });

  it('falls back to getRandomValues on insecure origins', () => {
    const values = new Uint8Array(16).fill(0xff);
    const uuid = createUuid({
      getRandomValues: (target) => {
        target.set(values.subarray(0, target.length));
        return target;
      },
    });

    expect(uuid).toMatch(UUID_V4);
    expect(uuid).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('is available in this runtime', () => {
    expect(createUuid()).toMatch(UUID_V4);
  });
});
