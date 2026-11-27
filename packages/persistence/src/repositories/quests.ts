import { and, asc, eq, or, sql } from 'drizzle-orm';

import type { DbExecutor } from '../client';
import { characterQuests, type CharacterQuest } from '../schema/index';

/** Full history, including daily rows from earlier periods. */
export async function listCharacterQuests(
  executor: DbExecutor,
  characterId: string,
): Promise<CharacterQuest[]> {
  return executor
    .select()
    .from(characterQuests)
    .where(eq(characterQuests.characterId, characterId))
    .orderBy(asc(characterQuests.acceptedAt));
}

/**
 * One-time quests plus the daily rows of the current period (ADR-038). Older
 * daily periods stay in the table as history but never surface to the player.
 */
export async function listCharacterQuestsForPeriod(
  executor: DbExecutor,
  characterId: string,
  periodKey: string,
): Promise<CharacterQuest[]> {
  return executor
    .select()
    .from(characterQuests)
    .where(
      and(
        eq(characterQuests.characterId, characterId),
        or(eq(characterQuests.periodKey, ''), eq(characterQuests.periodKey, periodKey)),
      ),
    )
    .orderBy(asc(characterQuests.acceptedAt));
}

export async function findCharacterQuestForUpdate(
  executor: DbExecutor,
  characterId: string,
  questId: string,
  periodKey: string,
): Promise<CharacterQuest | undefined> {
  const [row] = await executor
    .select()
    .from(characterQuests)
    .where(
      and(
        eq(characterQuests.characterId, characterId),
        eq(characterQuests.questId, questId),
        eq(characterQuests.periodKey, periodKey),
      ),
    )
    .for('update');
  return row;
}

export async function insertCharacterQuest(
  executor: DbExecutor,
  input: { characterId: string; questId: string; periodKey: string; now: Date },
): Promise<CharacterQuest | undefined> {
  const [row] = await executor
    .insert(characterQuests)
    .values({
      characterId: input.characterId,
      questId: input.questId,
      periodKey: input.periodKey,
      status: 'active',
      progress: 0,
      acceptedAt: input.now,
      updatedAt: input.now,
    })
    .returning();
  return row;
}

/**
 * Records one unit of progress. The conditional WHERE keeps a duplicate or
 * out-of-order event from reviving a quest that already completed.
 */
export async function advanceCharacterQuest(
  executor: DbExecutor,
  input: {
    characterId: string;
    questId: string;
    periodKey: string;
    progress: number;
    completed: boolean;
    now: Date;
  },
): Promise<CharacterQuest | undefined> {
  const [row] = await executor
    .update(characterQuests)
    .set({
      progress: input.progress,
      status: input.completed ? 'completed' : 'active',
      ...(input.completed ? { completedAt: input.now } : {}),
      version: sql`${characterQuests.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(characterQuests.characterId, input.characterId),
        eq(characterQuests.questId, input.questId),
        eq(characterQuests.periodKey, input.periodKey),
        eq(characterQuests.status, 'active'),
      ),
    )
    .returning();
  return row;
}

export async function markCharacterQuestClaimed(
  executor: DbExecutor,
  input: { characterId: string; questId: string; periodKey: string; now: Date },
): Promise<CharacterQuest | undefined> {
  const [row] = await executor
    .update(characterQuests)
    .set({
      status: 'claimed',
      claimedAt: input.now,
      version: sql`${characterQuests.version} + 1`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(characterQuests.characterId, input.characterId),
        eq(characterQuests.questId, input.questId),
        eq(characterQuests.periodKey, input.periodKey),
        eq(characterQuests.status, 'completed'),
      ),
    )
    .returning();
  return row;
}
