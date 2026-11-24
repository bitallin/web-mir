import { createOpaqueToken, hashToken } from './tokens';

export const SESSION_POLICY = {
  accessTtlSeconds: 15 * 60,
  refreshTtlSeconds: 30 * 24 * 60 * 60,
} as const;

export type SessionPolicy = {
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
};

export type IssuedSessionTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

/**
 * Access and refresh tokens are separate random values; only their SHA-256
 * digests are stored, so a database leak cannot be replayed as a session.
 */
export function createSessionTokens(
  nowMs: number = Date.now(),
  policy: SessionPolicy = SESSION_POLICY,
): IssuedSessionTokens {
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new RangeError('nowMs must be a non-negative finite number');
  }

  const accessToken = createOpaqueToken();
  const refreshToken = createOpaqueToken();

  return {
    accessToken,
    refreshToken,
    accessTokenHash: hashToken(accessToken),
    refreshTokenHash: hashToken(refreshToken),
    accessExpiresAt: new Date(nowMs + policy.accessTtlSeconds * 1_000),
    refreshExpiresAt: new Date(nowMs + policy.refreshTtlSeconds * 1_000),
  };
}
