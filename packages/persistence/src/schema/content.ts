import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { adminUsers } from './admin';
import { realms } from './realms';

/** Mirrors the contracts content sections (ADR-022). */
export const CONTENT_SECTION_IDS = [
  'classes',
  'skills',
  'monsters',
  'items',
  'lootTables',
  'rules',
  'quests',
] as const;

export const contentSectionEnum = pgEnum('content_section', CONTENT_SECTION_IDS);

/**
 * One row per content type. A draft stores the full section; publishing merges
 * every draft over the active release and creates an immutable release.
 */
export const contentDrafts = pgTable('content_drafts', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  section: contentSectionEnum('section').notNull().unique(),
  payload: jsonb('payload').notNull(),
  updatedBy: uuid('updated_by').references(() => adminUsers.id, { onDelete: 'set null' }),
  updatedByUsername: text('updated_by_username').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ContentDraft = typeof contentDrafts.$inferSelect;

/** Immutable release. Services only insert; no update path exists. */
export const contentReleases = pgTable(
  'content_releases',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    version: text('version').notNull().unique(),
    schemaVersion: integer('schema_version').notNull(),
    checksum: text('checksum').notNull(),
    payload: jsonb('payload').notNull(),
    changeSummary: jsonb('change_summary').notNull(),
    createdBy: uuid('created_by').references(() => adminUsers.id, { onDelete: 'set null' }),
    createdByUsername: text('created_by_username').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('content_releases_created_idx').on(table.createdAt)],
);

export type ContentRelease = typeof contentReleases.$inferSelect;

/** Points a realm at its current release; updated only by activation. */
export const realmActiveContent = pgTable('realm_active_content', {
  realmId: uuid('realm_id')
    .primaryKey()
    .references(() => realms.id, { onDelete: 'cascade' }),
  contentReleaseId: uuid('content_release_id')
    .notNull()
    .references(() => contentReleases.id, { onDelete: 'restrict' }),
  activatedBy: uuid('activated_by').references(() => adminUsers.id, { onDelete: 'set null' }),
  activatedByUsername: text('activated_by_username').notNull(),
  reason: text('reason').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only activation history; rollback is a new row pointing backwards. */
export const contentActivations = pgTable(
  'content_activations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    realmId: uuid('realm_id')
      .notNull()
      .references(() => realms.id, { onDelete: 'cascade' }),
    contentReleaseId: uuid('content_release_id')
      .notNull()
      .references(() => contentReleases.id, { onDelete: 'restrict' }),
    activatedBy: uuid('activated_by').references(() => adminUsers.id, { onDelete: 'set null' }),
    activatedByUsername: text('activated_by_username').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('content_activations_realm_idx').on(table.realmId, table.createdAt)],
);

export type ContentActivation = typeof contentActivations.$inferSelect;
