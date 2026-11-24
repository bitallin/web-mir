import { and, eq, gt, isNull } from 'drizzle-orm';

import type { Database } from '../client';
import { accountSessions, type AccountSession } from '../schema/index';

export type SessionTokenSet = {
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

export type CreateSessionInput = SessionTokenSet & { accountId: string };

export async function insertSession(
  db: Database,
  input: CreateSessionInput,
): Promise<AccountSession> {
  const [session] = await db.insert(accountSessions).values(input).returning();
  if (session === undefined) {
    throw new Error('session insert returned no row');
  }
  return session;
}

export async function findSessionByAccessHash(
  db: Database,
  accessTokenHash: string,
  now: Date,
): Promise<AccountSession | undefined> {
  const [session] = await db
    .select()
    .from(accountSessions)
    .where(
      and(
        eq(accountSessions.accessTokenHash, accessTokenHash),
        isNull(accountSessions.revokedAt),
        gt(accountSessions.accessExpiresAt, now),
      ),
    )
    .limit(1);
  return session;
}

export async function findSessionByRefreshHash(
  db: Database,
  refreshTokenHash: string,
  now: Date,
): Promise<AccountSession | undefined> {
  const [session] = await db
    .select()
    .from(accountSessions)
    .where(
      and(
        eq(accountSessions.refreshTokenHash, refreshTokenHash),
        isNull(accountSessions.revokedAt),
        gt(accountSessions.refreshExpiresAt, now),
      ),
    )
    .limit(1);
  return session;
}

/**
 * Replaces both token digests. A replayed old refresh token finds no row and
 * cannot revive the session.
 */
export async function rotateSession(
  db: Database,
  sessionId: string,
  tokens: SessionTokenSet,
  now: Date,
): Promise<AccountSession | undefined> {
  const [session] = await db
    .update(accountSessions)
    .set({ ...tokens, updatedAt: now })
    .where(and(eq(accountSessions.id, sessionId), isNull(accountSessions.revokedAt)))
    .returning();
  return session;
}

export async function revokeSession(db: Database, sessionId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(accountSessions)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(accountSessions.id, sessionId), isNull(accountSessions.revokedAt)))
    .returning({ id: accountSessions.id });
  return rows.length > 0;
}

/** Logout must work even when the short-lived access token just expired. */
export async function revokeSessionByAccessHash(
  db: Database,
  accessTokenHash: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(accountSessions)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(eq(accountSessions.accessTokenHash, accessTokenHash), isNull(accountSessions.revokedAt)),
    )
    .returning({ id: accountSessions.id });
  return rows.length > 0;
}
