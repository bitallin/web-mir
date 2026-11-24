import { describe, expect, it } from 'vitest';

import {
  loginRequestSchema,
  normalizeUsername,
  registerRequestSchema,
  usernameSchema,
} from './auth';

describe('accounts', () => {
  it('normalizes usernames to a case-folded uniqueness key', () => {
    expect(normalizeUsername('  Alice_01 ')).toBe('alice_01');
  });

  it('accepts 3–24 letters, digits and underscores', () => {
    for (const username of ['abc', 'Alice_01', 'a'.repeat(24)]) {
      expect(usernameSchema.safeParse(username).success).toBe(true);
    }
  });

  it('rejects short, long and non-ASCII usernames', () => {
    for (const username of ['ab', 'a'.repeat(25), '玩家一', 'a b', 'a-b']) {
      expect(usernameSchema.safeParse(username).success).toBe(false);
    }
  });

  it('enforces password length and rejects extra fields', () => {
    expect(registerRequestSchema.safeParse({ username: 'alice', password: 'short' }).success).toBe(
      false,
    );
    expect(
      registerRequestSchema.safeParse({ username: 'alice', password: 'long-enough', role: 'admin' })
        .success,
    ).toBe(false);
    expect(
      loginRequestSchema.safeParse({ username: 'alice', password: 'x'.repeat(129) }).success,
    ).toBe(false);
  });
});
