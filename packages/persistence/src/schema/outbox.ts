import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { adminAuditLogs, adminUsers } from './admin';

export const ADMIN_COMMAND_TYPE_IDS = ['kick', 'ban', 'mute'] as const;
export const ADMIN_COMMAND_STATUS_IDS = ['pending', 'dispatched', 'applied', 'failed'] as const;

export const adminCommandTypeEnum = pgEnum('admin_command_type', ADMIN_COMMAND_TYPE_IDS);
export const adminCommandStatusEnum = pgEnum('admin_command_status', ADMIN_COMMAND_STATUS_IDS);

/**
 * Transactional outbox for administrator commands (ADR-022). It is the durable
 * record of intent; HTTP delivery to the game server is only a transport and
 * may be retried. `command_id` is the idempotency key the game server honors.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    commandId: uuid('command_id').notNull(),
    type: adminCommandTypeEnum('type').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    /** Display name captured at creation, so history survives renames. */
    targetName: text('target_name').notNull(),
    payload: jsonb('payload').notNull(),
    reason: text('reason').notNull(),
    actorAdminId: uuid('actor_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    actorUsername: text('actor_username').notNull(),
    auditLogId: uuid('audit_log_id').references(() => adminAuditLogs.id, {
      onDelete: 'set null',
    }),
    status: adminCommandStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('outbox_events_command_unique').on(table.commandId),
    index('outbox_events_pending_idx').on(table.status, table.nextAttemptAt),
    index('outbox_events_target_idx').on(table.targetType, table.targetId, table.createdAt),
  ],
);

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
