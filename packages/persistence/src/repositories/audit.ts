import { and, count, desc, eq, ilike, type SQL } from 'drizzle-orm';

import type { Database, DbExecutor } from '../client';
import { adminAuditLogs, type AdminAuditLog, type NewAdminAuditLog } from '../schema/admin';

export type InsertAdminAuditInput = {
  requestId: string;
  actorAdminId: string | null;
  actorUsername: string;
  actorRole: NewAdminAuditLog['actorRole'];
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  before?: unknown;
  after?: unknown;
  result: NewAdminAuditLog['result'];
  errorCode?: string | null;
  createdAt?: Date;
};

export async function insertAdminAudit(
  executor: DbExecutor,
  input: InsertAdminAuditInput,
): Promise<AdminAuditLog> {
  const [row] = await executor
    .insert(adminAuditLogs)
    .values({
      requestId: input.requestId,
      actorAdminId: input.actorAdminId,
      actorUsername: input.actorUsername,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      before: input.before ?? null,
      after: input.after ?? null,
      result: input.result,
      errorCode: input.errorCode ?? null,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    })
    .returning();
  if (row === undefined) {
    throw new Error('failed to insert admin audit log');
  }
  return row;
}

export type AdminAuditFilter = {
  actor?: string;
  action?: string;
  targetId?: string;
  result?: AdminAuditLog['result'];
  page: number;
  pageSize: number;
};

export type AdminAuditPage = {
  items: AdminAuditLog[];
  total: number;
};

export async function listAdminAudit(
  db: Database,
  filter: AdminAuditFilter,
): Promise<AdminAuditPage> {
  const conditions: SQL[] = [];
  if (filter.actor !== undefined) {
    conditions.push(ilike(adminAuditLogs.actorUsername, `%${filter.actor}%`));
  }
  if (filter.action !== undefined) {
    conditions.push(eq(adminAuditLogs.action, filter.action));
  }
  if (filter.targetId !== undefined) {
    conditions.push(eq(adminAuditLogs.targetId, filter.targetId));
  }
  if (filter.result !== undefined) {
    conditions.push(eq(adminAuditLogs.result, filter.result));
  }
  const where = conditions.length === 0 ? undefined : and(...conditions);

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(adminAuditLogs)
      .where(where)
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize),
    db.select({ total: count() }).from(adminAuditLogs).where(where),
  ]);

  return { items: rows, total: totals[0]?.total ?? 0 };
}

export async function countAuditForTarget(
  db: Database,
  targetType: string,
  targetId: string,
  limit: number,
): Promise<AdminAuditLog[]> {
  return db
    .select()
    .from(adminAuditLogs)
    .where(and(eq(adminAuditLogs.targetType, targetType), eq(adminAuditLogs.targetId, targetId)))
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(limit);
}
