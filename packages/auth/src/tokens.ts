import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const OPAQUE_TOKEN_BYTES = 32;

/**
 * 256-bit URL-safe token. Session and game-ticket tokens are high-entropy, so
 * a fast digest is enough for at-rest storage; only passwords need Argon2id.
 */
export function createOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function tokenHashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
