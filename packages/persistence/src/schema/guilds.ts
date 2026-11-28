import { sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { characters } from './characters';
import { realms } from './realms';

export const GUILD_ROLE_IDS = ['leader', 'member'] as const;
export type GuildRoleId = (typeof GUILD_ROLE_IDS)[number];

/**
 * Persistent guild identity (ADR-048). Online state is deliberately absent:
 * the roster snapshot merges it from the process-wide player directory, so a
 * stale row can never claim a member is online.
 */
export const guilds = pgTable(
  'guilds',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    realmId: uuid('realm_id')
      .notNull()
      .references(() => realms.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** NFKC + lowercase; uniqueness within a realm (ADR-048 §4.1). */
    nameNormalized: text('name_normalized').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('guilds_realm_name_unique').on(table.realmId, table.nameNormalized)],
);

export type Guild = typeof guilds.$inferSelect;
export type NewGuild = typeof guilds.$inferInsert;

/**
 * One membership row per character. The partial unique index keeps at most one
 * leader per guild; leadership changes update roles inside one transaction.
 */
export const guildMembers = pgTable(
  'guild_members',
  {
    guildId: uuid('guild_id')
      .notNull()
      .references(() => guilds.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    role: text('role', { enum: GUILD_ROLE_IDS }).notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.characterId] }),
    uniqueIndex('guild_members_character_unique').on(table.characterId),
    uniqueIndex('guild_members_single_leader')
      .on(table.guildId)
      .where(sql`${table.role} = 'leader'`),
    index('guild_members_guild_idx').on(table.guildId),
  ],
);

export type GuildMember = typeof guildMembers.$inferSelect;
export type NewGuildMember = typeof guildMembers.$inferInsert;
