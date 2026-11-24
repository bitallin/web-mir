import { describe, expect, it } from 'vitest';

import { createOpaqueToken, hashToken, tokenHashesEqual } from './tokens';

describe('opaque tokens', () => {
  it('creates unique URL-safe tokens with 256 bits of entropy', () => {
    const tokens = new Set(Array.from({ length: 64 }, () => createOpaqueToken()));

    expect(tokens.size).toBe(64);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    }
  });

  it('hashes deterministically without exposing the token', () => {
    const token = createOpaqueToken();
    const digest = hashToken(token);

    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(digest).not.toContain(token);
    expect(hashToken(token)).toBe(digest);
    expect(hashToken(`${token}x`)).not.toBe(digest);
  });

  it('compares hashes of equal length only', () => {
    const digest = hashToken('token');

    expect(tokenHashesEqual(digest, digest)).toBe(true);
    expect(tokenHashesEqual(digest, hashToken('other'))).toBe(false);
    expect(tokenHashesEqual(digest, digest.slice(0, -1))).toBe(false);
  });
});
