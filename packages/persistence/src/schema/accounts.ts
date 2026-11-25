import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const ACCOUNT_STATUSES = ['active', 'banned'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const accounts = pgTable('accounts', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  username: text('username').notNull(),
  /** Case-folded uniqueness key; usernames are ASCII-only. */
  usernameNormalized: text('username_normalized').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  status: text('status', { enum: ACCOUNT_STATUSES }).notNull().default('active'),
  /** Chat mute expiry; null means unmuted. Applied even before rejoining. */
  mutedUntil: timestamp('muted_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

/**
 * One row per login session. Both token digests live here so a refresh rotates
 * the pair atomically and logout revokes the row (ADR-017).
 */
export const accountSessions = pgTable(
  'account_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    accessTokenHash: text('access_token_hash').notNull().unique(),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('account_sessions_account_id_idx').on(table.accountId)],
);

export type AccountSession = typeof accountSessions.$inferSelect;
