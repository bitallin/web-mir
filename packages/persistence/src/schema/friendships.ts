import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { characters } from './characters';

export const FRIENDSHIP_STATUS_IDS = ['pending', 'accepted'] as const;
export type FriendshipStatusId = (typeof FRIENDSHIP_STATUS_IDS)[number];

/**
 * One row per unordered character pair (ADR-045). The pair is stored in
 * canonical UUID order so a request from either side can never create a
 * second row for the same friendship; `requested_by_id` remembers who asked
 * so only the other side can accept or decline.
 */
export const friendships = pgTable(
  'friendships',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    lowCharacterId: uuid('low_character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    highCharacterId: uuid('high_character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    requestedById: uuid('requested_by_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    status: text('status', { enum: FRIENDSHIP_STATUS_IDS }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('friendships_pair_unique').on(table.lowCharacterId, table.highCharacterId),
    index('friendships_low_status_idx').on(table.lowCharacterId, table.status),
    index('friendships_high_status_idx').on(table.highCharacterId, table.status),
    check('friendships_pair_order_check', sql`${table.lowCharacterId} < ${table.highCharacterId}`),
    check(
      'friendships_requested_by_check',
      sql`${table.requestedById} = ${table.lowCharacterId} OR ${table.requestedById} = ${table.highCharacterId}`,
    ),
    check(
      'friendships_responded_at_check',
      sql`(${table.status} = 'pending') = (${table.respondedAt} IS NULL)`,
    ),
  ],
);

export type Friendship = typeof friendships.$inferSelect;
export type NewFriendship = typeof friendships.$inferInsert;
