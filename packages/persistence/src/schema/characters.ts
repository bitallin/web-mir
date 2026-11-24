import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { accounts } from './accounts';
import { realms } from './realms';

export const CHARACTER_CLASS_IDS = ['warrior', 'mage', 'taoist'] as const;
export type CharacterClassId = (typeof CHARACTER_CLASS_IDS)[number];

export const characters = pgTable(
  'characters',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    realmId: uuid('realm_id')
      .notNull()
      .references(() => realms.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** NFKC + lowercase; uniqueness within a realm (ADR-017). */
    nameNormalized: text('name_normalized').notNull(),
    classId: text('class_id', { enum: CHARACTER_CLASS_IDS }).notNull(),
    level: integer('level').notNull().default(1),
    exp: integer('exp').notNull().default(0),
    hp: integer('hp').notNull(),
    maxHp: integer('max_hp').notNull(),
    mp: integer('mp').notNull(),
    maxMp: integer('max_mp').notNull(),
    mapId: text('map_id').notNull(),
    /** Authoritative position in integer sub-tile units. */
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    facing: smallint('facing').notNull().default(2),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('characters_realm_name_unique').on(table.realmId, table.nameNormalized),
    index('characters_account_id_idx').on(table.accountId),
  ],
);

export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;

/**
 * Lease that guarantees one character is controlled by one client at a time.
 * Expiry lets a crashed game server release control without manual cleanup.
 */
export const characterSessions = pgTable('character_sessions', {
  characterId: uuid('character_id')
    .primaryKey()
    .references(() => characters.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull(),
  gameServerId: text('game_server_id').notNull(),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CharacterSession = typeof characterSessions.$inferSelect;
