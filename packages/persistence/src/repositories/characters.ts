import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import type { Database, DbExecutor } from '../client';
import {
  characters,
  characterSessions,
  currencyLedger,
  itemInstances,
  realms,
  wallets,
  type Character,
  type CharacterClassId,
  type CharacterSession,
} from '../schema/index';

export type CharacterWithRealm = Character & { realmCode: string };

export type CreateCharacterInput = {
  accountId: string;
  realmId: string;
  name: string;
  nameNormalized: string;
  classId: CharacterClassId;
  level: number;
  exp: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  mapId: string;
  x: number;
  y: number;
  facing: number;
};

export async function insertCharacter(
  db: Database,
  input: CreateCharacterInput,
): Promise<Character> {
  const [character] = await db.insert(characters).values(input).returning();
  if (character === undefined) {
    throw new Error('character insert returned no row');
  }
  return character;
}

export type StarterItemInput = { templateId: string; quantity: number };

/**
 * Creates the character and its starter inventory in one transaction, so a new
 * character can never exist with a partially provisioned bag.
 */
export async function insertCharacterWithItems(
  db: Database,
  input: CreateCharacterInput,
  items: readonly StarterItemInput[],
  starterGold = 0,
): Promise<Character> {
  return db.transaction(async (tx) => {
    const [character] = await tx.insert(characters).values(input).returning();
    if (character === undefined) {
      throw new Error('character insert returned no row');
    }
    if (items.length > 0) {
      await tx.insert(itemInstances).values(
        items.map((item, index) => ({
          templateId: item.templateId,
          characterId: character.id,
          container: 'inventory' as const,
          slotIndex: index,
          quantity: item.quantity,
        })),
      );
    }
    if (starterGold > 0) {
      await tx
        .insert(wallets)
        .values({ characterId: character.id, balance: starterGold, version: 1 });
      await tx.insert(currencyLedger).values({
        characterId: character.id,
        currencyType: 'gold',
        delta: starterGold,
        balanceAfter: starterGold,
        reason: 'starter_gold',
        referenceId: character.id,
        idempotencyKey: `starter:${character.id}:gold`,
      });
    }
    return character;
  });
}

export async function listCharactersByAccount(
  db: Database,
  accountId: string,
): Promise<CharacterWithRealm[]> {
  const rows = await db
    .select({ character: characters, realmCode: realms.code })
    .from(characters)
    .innerJoin(realms, eq(characters.realmId, realms.id))
    .where(eq(characters.accountId, accountId))
    .orderBy(asc(characters.createdAt));
  return rows.map((row) => ({ ...row.character, realmCode: row.realmCode }));
}

export async function findCharacterForAccount(
  db: Database,
  characterId: string,
  accountId: string,
): Promise<CharacterWithRealm | undefined> {
  const [row] = await db
    .select({ character: characters, realmCode: realms.code })
    .from(characters)
    .innerJoin(realms, eq(characters.realmId, realms.id))
    .where(and(eq(characters.id, characterId), eq(characters.accountId, accountId)))
    .limit(1);
  return row === undefined ? undefined : { ...row.character, realmCode: row.realmCode };
}

export async function findCharacterById(
  db: DbExecutor,
  characterId: string,
): Promise<Character | undefined> {
  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  return character;
}

export type CharacterCheckpoint = {
  characterId: string;
  /** The map the session was simulating when it took this snapshot. */
  mapId: string;
  x: number;
  y: number;
  facing: number;
  hp: number;
  mp: number;
};

/**
 * Throttled snapshot of transient state. The map id is part of the predicate:
 * a checkpoint that was in flight while the character transferred must not
 * write old-map coordinates onto the newly persisted destination (TD-DATA-03).
 */
export async function saveCharacterCheckpoint(
  db: Database,
  checkpoint: CharacterCheckpoint,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(characters)
    .set({
      x: checkpoint.x,
      y: checkpoint.y,
      facing: checkpoint.facing,
      hp: checkpoint.hp,
      mp: checkpoint.mp,
      version: sql`${characters.version} + 1`,
      updatedAt: now,
    })
    .where(and(eq(characters.id, checkpoint.characterId), eq(characters.mapId, checkpoint.mapId)));
}

export type CharacterTransfer = {
  characterId: string;
  mapId: string;
  x: number;
  y: number;
  facing: number;
  hp: number;
  mp: number;
};

/**
 * Commits a server-initiated map transfer. The map id is only written here:
 * ordinary checkpoints never move a character between maps.
 */
export async function saveCharacterTransfer(
  db: Database,
  transfer: CharacterTransfer,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(characters)
    .set({
      mapId: transfer.mapId,
      x: transfer.x,
      y: transfer.y,
      facing: transfer.facing,
      hp: transfer.hp,
      mp: transfer.mp,
      version: sql`${characters.version} + 1`,
      updatedAt: now,
    })
    .where(eq(characters.id, transfer.characterId));
}

export type RelocateCharactersInput = {
  fromMapId: string;
  toMapId: string;
  x: number;
  y: number;
  facing: number;
};

/**
 * Maintenance helper for retired map templates: moves every character still
 * standing on `fromMapId` to the target map spawn. Idempotent by construction;
 * returns the number of moved rows.
 */
export async function relocateCharactersFromMap(
  db: Database,
  input: RelocateCharactersInput,
  now: Date = new Date(),
): Promise<number> {
  const moved = await db
    .update(characters)
    .set({
      mapId: input.toMapId,
      x: input.x,
      y: input.y,
      facing: input.facing,
      version: sql`${characters.version} + 1`,
      updatedAt: now,
    })
    .where(eq(characters.mapId, input.fromMapId))
    .returning({ id: characters.id });
  return moved.length;
}

export type AcquireLeaseInput = {
  characterId: string;
  sessionId: string;
  gameServerId: string;
  leaseExpiresAt: Date;
  now: Date;
};

/**
 * Inserts a fresh lease or takes over an expired one. The conditional UPDATE
 * is atomic in PostgreSQL, so two simultaneous logins cannot both win.
 */
export async function acquireCharacterLease(
  db: Database,
  input: AcquireLeaseInput,
): Promise<boolean> {
  const inserted = await db
    .insert(characterSessions)
    .values({
      characterId: input.characterId,
      sessionId: input.sessionId,
      gameServerId: input.gameServerId,
      leaseExpiresAt: input.leaseExpiresAt,
      acquiredAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .returning({ characterId: characterSessions.characterId });

  if (inserted.length > 0) {
    return true;
  }

  const updated = await db
    .update(characterSessions)
    .set({
      sessionId: input.sessionId,
      gameServerId: input.gameServerId,
      leaseExpiresAt: input.leaseExpiresAt,
      acquiredAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(characterSessions.characterId, input.characterId),
        or(
          lt(characterSessions.leaseExpiresAt, input.now),
          eq(characterSessions.sessionId, input.sessionId),
        ),
      ),
    )
    .returning({ characterId: characterSessions.characterId });

  return updated.length > 0;
}

export async function findCharacterLease(
  db: Database,
  characterId: string,
): Promise<CharacterSession | undefined> {
  const [lease] = await db
    .select()
    .from(characterSessions)
    .where(eq(characterSessions.characterId, characterId))
    .limit(1);
  return lease;
}

export async function refreshCharacterLeases(
  db: Database,
  sessionIds: readonly string[],
  leaseExpiresAt: Date,
  now: Date,
): Promise<void> {
  if (sessionIds.length === 0) {
    return;
  }
  await db
    .update(characterSessions)
    .set({ leaseExpiresAt, updatedAt: now })
    .where(inArray(characterSessions.sessionId, [...sessionIds]));
}

export async function releaseCharacterLease(
  db: Database,
  characterId: string,
  sessionId: string,
): Promise<void> {
  await db
    .delete(characterSessions)
    .where(
      and(
        eq(characterSessions.characterId, characterId),
        eq(characterSessions.sessionId, sessionId),
      ),
    );
}
