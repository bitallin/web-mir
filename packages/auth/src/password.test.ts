import { describe, expect, it } from 'vitest';

import { ARGON2ID_PARAMS, hashPassword, verifyPassword } from './password';

// Test-only parameters keep the suite fast while exercising the same encoder.
const TEST_PARAMS = { ...ARGON2ID_PARAMS, memory: 512, passes: 1, parallelism: 1 };

describe('password hashing', () => {
  it('accepts the original password and rejects a different one', async () => {
    const encoded = await hashPassword('correct horse battery', TEST_PARAMS);

    await expect(verifyPassword(encoded, 'correct horse battery')).resolves.toBe(true);
    await expect(verifyPassword(encoded, 'correct horse batterY')).resolves.toBe(false);
    await expect(verifyPassword(encoded, '')).resolves.toBe(false);
  });

  it('produces a versioned Argon2id PHC string with a fresh salt', async () => {
    const first = await hashPassword('same-password', TEST_PARAMS);
    const second = await hashPassword('same-password', TEST_PARAMS);

    expect(first).toMatch(/^\$argon2id\$v=19\$m=512,t=1,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/u);
    expect(first).not.toBe(second);
    await expect(verifyPassword(second, 'same-password')).resolves.toBe(true);
  });

  it('rejects malformed or tampered hashes without throwing', async () => {
    await expect(verifyPassword('not-a-hash', 'x')).resolves.toBe(false);
    await expect(verifyPassword('$argon2id$v=19$m=512,t=1,p=1$salt$hash', 'x')).resolves.toBe(
      false,
    );

    const encoded = await hashPassword('secret', TEST_PARAMS);
    // Flip the first base64 character of the derived key. Changing the last
    // character can only touch padding bits and decode to the same 32 bytes.
    const segments = encoded.split('$');
    const derived = segments[5];
    expect(derived).toBeDefined();
    const tamperedKey = `${derived?.[0] === 'A' ? 'B' : 'A'}${derived?.slice(1) ?? ''}`;
    const tampered = [...segments.slice(0, 5), tamperedKey].join('$');
    await expect(verifyPassword(tampered, 'secret')).resolves.toBe(false);
  });
});
