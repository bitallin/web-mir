import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { accounts } from './accounts';
import { characters } from './characters';
import { realms } from './realms';

/**
 * Short-lived, single-use game connection ticket. Only the SHA-256 digest is
 * stored; the game server consumes the row atomically before an authoritative
 * character is created in a room (ADR-017).
 */
export const gameTickets = pgTable(
  'game_tickets',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    tokenHash: text('token_hash').notNull().unique(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    realmId: uuid('realm_id')
      .notNull()
      .references(() => realms.id, { onDelete: 'restrict' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedBy: text('consumed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('game_tickets_character_id_idx').on(table.characterId)],
);

export type GameTicket = typeof gameTickets.$inferSelect;
