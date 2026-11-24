import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const REALM_STATUSES = ['active', 'maintenance', 'closed'] as const;
export type RealmStatus = (typeof REALM_STATUSES)[number];

/**
 * A realm is the logical world a character belongs to. This is the first
 * persistent table; account and character tables arrive in Phase 2.
 */
export const realms = pgTable('realms', {
  // PostgreSQL 18 provides native UUIDv7 generation.
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  status: text('status', { enum: REALM_STATUSES }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Realm = typeof realms.$inferSelect;
export type NewRealm = typeof realms.$inferInsert;
