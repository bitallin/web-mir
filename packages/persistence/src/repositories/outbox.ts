import { and, asc, count, desc, eq, lt, lte, type SQL } from 'drizzle-orm';

import type { Database, DbExecutor } from '../client';
import { outboxEvents, type NewOutboxEvent, type OutboxEvent } from '../schema/outbox';

export type InsertOutboxEventInput = Omit<
  NewOutboxEvent,
  'id' | 'status' | 'attempts' | 'nextAttemptAt' | 'dispatchedAt' | 'appliedAt'
> & {
  createdAt?: Date;
  nextAttemptAt?: Date;
};

export async function insertOutboxEvent(
  executor: DbExecutor,
  input: InsertOutboxEventInput,
): Promise<OutboxEvent> {
  const [row] = await executor
    .insert(outboxEvents)
    .values({
      ...input,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: input.nextAttemptAt ?? input.createdAt ?? new Date(),
    })
    .returning();
  if (row === undefined) {
    throw new Error('failed to insert outbox event');
  }
  return row;
}

export type ClaimOptions = {
  now: Date;
  limit: number;
  /** A `dispatched` row older than this is considered lost and retried. */
  staleDispatchedBefore: Date;
};

/**
 * Claims due rows for the dispatcher. Rows are locked with SKIP LOCKED so two
 * processes can never deliver the same command simultaneously; the game server
 * still deduplicates by command id (ADR-022).
 */
export async function claimPendingCommands(
  db: Database,
  options: ClaimOptions,
): Promise<OutboxEvent[]> {
  await db
    .update(outboxEvents)
    .set({ status: 'pending', nextAttemptAt: options.now })
    .where(
      and(
        eq(outboxEvents.status, 'dispatched'),
        lt(outboxEvents.dispatchedAt, options.staleDispatchedBefore),
      ),
    );

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.status, 'pending'), lte(outboxEvents.nextAttemptAt, options.now)))
      .orderBy(asc(outboxEvents.createdAt))
      .limit(options.limit)
      .for('update', { skipLocked: true });

    const claimed: OutboxEvent[] = [];
    for (const row of rows) {
      const [updated] = await tx
        .update(outboxEvents)
        .set({
          status: 'dispatched',
          attempts: row.attempts + 1,
          dispatchedAt: options.now,
          lastError: null,
        })
        .where(eq(outboxEvents.id, row.id))
        .returning();
      if (updated !== undefined) {
        claimed.push(updated);
      }
    }
    return claimed;
  });
}

export async function markCommandApplied(db: Database, id: string, now: Date): Promise<void> {
  await db
    .update(outboxEvents)
    .set({ status: 'applied', appliedAt: now, lastError: null })
    .where(eq(outboxEvents.id, id));
}

export async function scheduleCommandRetry(
  db: Database,
  id: string,
  errorMessage: string,
  nextAttemptAt: Date,
): Promise<void> {
  await db
    .update(outboxEvents)
    .set({
      status: 'pending',
      lastError: errorMessage.slice(0, 300),
      nextAttemptAt,
    })
    .where(eq(outboxEvents.id, id));
}

export async function markCommandFailed(
  db: Database,
  id: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(outboxEvents)
    .set({ status: 'failed', lastError: errorMessage.slice(0, 300) })
    .where(eq(outboxEvents.id, id));
}

export type AdminCommandFilter = {
  status?: OutboxEvent['status'];
  type?: OutboxEvent['type'];
  targetId?: string;
  page: number;
  pageSize: number;
};

export type AdminCommandPage = {
  items: OutboxEvent[];
  total: number;
};

export async function listOutboxCommands(
  db: Database,
  filter: AdminCommandFilter,
): Promise<AdminCommandPage> {
  const conditions: SQL[] = [];
  if (filter.status !== undefined) {
    conditions.push(eq(outboxEvents.status, filter.status));
  }
  if (filter.type !== undefined) {
    conditions.push(eq(outboxEvents.type, filter.type));
  }
  if (filter.targetId !== undefined) {
    conditions.push(eq(outboxEvents.targetId, filter.targetId));
  }
  const where = conditions.length === 0 ? undefined : and(...conditions);

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(outboxEvents)
      .where(where)
      .orderBy(desc(outboxEvents.createdAt))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize),
    db.select({ total: count() }).from(outboxEvents).where(where),
  ]);
  return { items: rows, total: totals[0]?.total ?? 0 };
}

export type OutboxStatusCounts = {
  pending: number;
  dispatched: number;
  applied: number;
  failed: number;
  oldestPendingAt: Date | null;
};

export async function outboxStatusCounts(db: Database): Promise<OutboxStatusCounts> {
  const rows = await db
    .select({ status: outboxEvents.status, total: count() })
    .from(outboxEvents)
    .groupBy(outboxEvents.status);
  const counts: OutboxStatusCounts = {
    pending: 0,
    dispatched: 0,
    applied: 0,
    failed: 0,
    oldestPendingAt: null,
  };
  for (const row of rows) {
    counts[row.status] = row.total;
  }
  const [oldest] = await db
    .select({ createdAt: outboxEvents.createdAt })
    .from(outboxEvents)
    .where(eq(outboxEvents.status, 'pending'))
    .orderBy(asc(outboxEvents.createdAt))
    .limit(1);
  counts.oldestPendingAt = oldest?.createdAt ?? null;
  return counts;
}
