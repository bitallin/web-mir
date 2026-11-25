import { sql } from 'drizzle-orm';
import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors the contracts role list; persistence stays independent of contracts. */
export const ADMIN_ROLE_IDS = [
  'super_admin',
  'ops_admin',
  'game_master',
  'content_designer',
  'release_approver',
  'analyst',
  'readonly_auditor',
] as const;

export const adminRoleEnum = pgEnum('admin_role', ADMIN_ROLE_IDS);
export const ADMIN_STATUSES = ['active', 'disabled'] as const;
export const adminStatusEnum = pgEnum('admin_status', ADMIN_STATUSES);
export const ADMIN_AUDIT_RESULTS = ['success', 'failed'] as const;
export const adminAuditResultEnum = pgEnum('admin_audit_result', ADMIN_AUDIT_RESULTS);

/**
 * Admin identities are deliberately separate from player accounts: banning a
 * player can never affect console access, and audit rows name a different
 * principal type (ADR-022).
 */
export const adminUsers = pgTable('admin_users', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`),
  username: text('username').notNull(),
  usernameNormalized: text('username_normalized').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: adminRoleEnum('role').notNull(),
  status: adminStatusEnum('status').notNull().default('active'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;

export const adminSessions = pgTable(
  'admin_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('admin_sessions_admin_idx').on(table.adminUserId, table.expiresAt)],
);

export type AdminSession = typeof adminSessions.$inferSelect;

/** Append-only. The Control API exposes no update or delete path. */
export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    requestId: text('request_id').notNull(),
    actorAdminId: uuid('actor_admin_id').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    actorUsername: text('actor_username').notNull(),
    actorRole: adminRoleEnum('actor_role').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    reason: text('reason'),
    before: jsonb('before'),
    after: jsonb('after'),
    result: adminAuditResultEnum('result').notNull(),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('admin_audit_created_idx').on(table.createdAt),
    index('admin_audit_actor_idx').on(table.actorUsername, table.createdAt),
    index('admin_audit_action_idx').on(table.action, table.createdAt),
    index('admin_audit_target_idx').on(table.targetType, table.targetId, table.createdAt),
  ],
);

export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLogs.$inferInsert;
