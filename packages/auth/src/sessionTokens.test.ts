import { describe, expect, it } from 'vitest';

import { SESSION_POLICY, createSessionTokens } from './sessionTokens';
import { hashToken } from './tokens';

describe('session tokens', () => {
  it('issues distinct access and refresh tokens with matching hashes', () => {
    const issued = createSessionTokens(1_700_000_000_000);

    expect(issued.accessToken).not.toBe(issued.refreshToken);
    expect(issued.accessTokenHash).toBe(hashToken(issued.accessToken));
    expect(issued.refreshTokenHash).toBe(hashToken(issued.refreshToken));
    expect(issued.accessExpiresAt.getTime()).toBe(
      1_700_000_000_000 + SESSION_POLICY.accessTtlSeconds * 1_000,
    );
    expect(issued.refreshExpiresAt.getTime()).toBe(
      1_700_000_000_000 + SESSION_POLICY.refreshTtlSeconds * 1_000,
    );
  });

  it('refreshes far outlive access tokens', () => {
    expect(SESSION_POLICY.refreshTtlSeconds).toBeGreaterThan(SESSION_POLICY.accessTtlSeconds);
  });

  it('rejects invalid clock input', () => {
    expect(() => createSessionTokens(Number.NaN)).toThrow(RangeError);
    expect(() => createSessionTokens(-1)).toThrow(RangeError);
  });
});
