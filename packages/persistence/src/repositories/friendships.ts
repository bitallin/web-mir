import { and, eq, inArray, ne, or } from 'drizzle-orm';

import type { DbExecutor } from '../client';
import { characters, friendships, type Friendship } from '../schema/index';

export type CanonicalPair = {
  lowCharacterId: string;
  highCharacterId: string;
};

/** UUID text order gives every unordered pair one canonical storage order. */
export function canonicalPair(a: string, b: string): CanonicalPair {
  return a < b
    ? { lowCharacterId: a, highCharacterId: b }
    : { lowCharacterId: b, highCharacterId: a };
}

export type CharacterProfile = {
  id: string;
  name: string;
  classId: string;
  level: number;
};

export async function findFriendship(
  executor: DbExecutor,
  a: string,
  b: string,
): Promise<Friendship | undefined> {
  const pair = canonicalPair(a, b);
  const [row] = await executor
    .select()
    .from(friendships)
    .where(
      and(
        eq(friendships.lowCharacterId, pair.lowCharacterId),
        eq(friendships.highCharacterId, pair.highCharacterId),
      ),
    )
    .limit(1);
  return row;
}

export async function findFriendshipById(
  executor: DbExecutor,
  requestId: string,
): Promise<Friendship | undefined> {
  const [row] = await executor
    .select()
    .from(friendships)
    .where(eq(friendships.id, requestId))
    .limit(1);
  return row;
}

export async function areFriends(executor: DbExecutor, a: string, b: string): Promise<boolean> {
  const row = await findFriendship(executor, a, b);
  return row?.status === 'accepted';
}

/** A pending row for an existing pair is returned as-is instead of duplicated. */
export async function insertFriendshipRequest(
  executor: DbExecutor,
  requesterId: string,
  addresseeId: string,
  now: Date,
): Promise<Friendship | undefined> {
  const pair = canonicalPair(requesterId, addresseeId);
  const [row] = await executor
    .insert(friendships)
    .values({
      lowCharacterId: pair.lowCharacterId,
      highCharacterId: pair.highCharacterId,
      requestedById: requesterId,
      status: 'pending',
      createdAt: now,
    })
    .returning();
  return row;
}

/**
 * Only the side that did not send the request can accept it, and only while it
 * is pending. An already accepted pair is returned so a duplicate accept is
 * harmless rather than an error.
 */
export async function acceptFriendshipRequest(
  executor: DbExecutor,
  requestId: string,
  acceptingId: string,
  now: Date,
): Promise<Friendship | undefined> {
  const [updated] = await executor
    .update(friendships)
    .set({ status: 'accepted', respondedAt: now })
    .where(
      and(
        eq(friendships.id, requestId),
        or(
          eq(friendships.lowCharacterId, acceptingId),
          eq(friendships.highCharacterId, acceptingId),
        ),
        ne(friendships.requestedById, acceptingId),
        eq(friendships.status, 'pending'),
      ),
    )
    .returning();
  if (updated !== undefined) {
    return updated;
  }
  const existing = await findFriendshipById(executor, requestId);
  if (
    existing?.status === 'accepted' &&
    (existing.lowCharacterId === acceptingId || existing.highCharacterId === acceptingId)
  ) {
    return existing;
  }
  return undefined;
}

/** Declining deletes the pending row so either side can ask again later. */
export async function declineFriendshipRequest(
  executor: DbExecutor,
  requestId: string,
  decliningId: string,
): Promise<boolean> {
  const result = await executor
    .delete(friendships)
    .where(
      and(
        eq(friendships.id, requestId),
        or(
          eq(friendships.lowCharacterId, decliningId),
          eq(friendships.highCharacterId, decliningId),
        ),
        ne(friendships.requestedById, decliningId),
        eq(friendships.status, 'pending'),
      ),
    )
    .returning({ id: friendships.id });
  return result.length > 0;
}

export async function deleteFriendshipBetween(
  executor: DbExecutor,
  a: string,
  b: string,
): Promise<boolean> {
  const pair = canonicalPair(a, b);
  const result = await executor
    .delete(friendships)
    .where(
      and(
        eq(friendships.lowCharacterId, pair.lowCharacterId),
        eq(friendships.highCharacterId, pair.highCharacterId),
        eq(friendships.status, 'accepted'),
      ),
    )
    .returning({ id: friendships.id });
  return result.length > 0;
}

/** Accepted rows on either side of the pair. */
export async function listAcceptedFriendships(
  executor: DbExecutor,
  characterId: string,
): Promise<Friendship[]> {
  return executor
    .select()
    .from(friendships)
    .where(
      and(
        eq(friendships.status, 'accepted'),
        or(
          eq(friendships.lowCharacterId, characterId),
          eq(friendships.highCharacterId, characterId),
        ),
      ),
    );
}

/** Pending requests in both directions; the caller knows who sent each one. */
export async function listPendingFriendships(
  executor: DbExecutor,
  characterId: string,
): Promise<Friendship[]> {
  return executor
    .select()
    .from(friendships)
    .where(
      and(
        eq(friendships.status, 'pending'),
        or(
          eq(friendships.lowCharacterId, characterId),
          eq(friendships.highCharacterId, characterId),
        ),
      ),
    );
}

export async function listCharacterProfiles(
  executor: DbExecutor,
  ids: readonly string[],
): Promise<CharacterProfile[]> {
  if (ids.length === 0) {
    return [];
  }
  return executor
    .select({
      id: characters.id,
      name: characters.name,
      classId: characters.classId,
      level: characters.level,
    })
    .from(characters)
    .where(inArray(characters.id, [...ids]));
}

/** Friend ids of one character, used for presence notifications. */
export async function listAcceptedFriendIds(
  executor: DbExecutor,
  characterId: string,
): Promise<string[]> {
  const rows = await listAcceptedFriendships(executor, characterId);
  return rows.map((row) =>
    row.lowCharacterId === characterId ? row.highCharacterId : row.lowCharacterId,
  );
}
