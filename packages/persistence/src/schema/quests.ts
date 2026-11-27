import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { characters } from './characters';

export const QUEST_STATUS_IDS = ['active', 'completed', 'claimed'] as const;
export type QuestStatusId = (typeof QUEST_STATUS_IDS)[number];

/**
 * One row per quest a character has touched. Quest definitions stay in the
 * immutable content release; this table only records progress and the claim
 * state, so a release rollback never loses a player's chain position (ADR-034).
 */
export const characterQuests = pgTable(
  'character_quests',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    questId: text('quest_id').notNull(),
    /**
     * Daily period key (`YYYY-MM-DD`), empty for one-time quests. A daily
     * quest gets a new row per period, so history survives the reset while the
     * unique constraint still stops a double accept within one period
     * (ADR-038).
     */
    periodKey: text('period_key').notNull().default(''),
    status: text('status', { enum: QUEST_STATUS_IDS }).notNull().default('active'),
    progress: integer('progress').notNull().default(0),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    version: integer('version').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('character_quests_character_quest_period_unique').on(
      table.characterId,
      table.questId,
      table.periodKey,
    ),
    index('character_quests_character_status_idx').on(table.characterId, table.status),
    check('character_quests_progress_non_negative', sql`${table.progress} >= 0`),
    check(
      'character_quests_completed_at_check',
      sql`(${table.status} = 'active') = (${table.completedAt} IS NULL)`,
    ),
    check(
      'character_quests_claimed_at_check',
      sql`(${table.status} = 'claimed') = (${table.claimedAt} IS NOT NULL)`,
    ),
  ],
);

export type CharacterQuest = typeof characterQuests.$inferSelect;
export type NewCharacterQuest = typeof characterQuests.$inferInsert;
