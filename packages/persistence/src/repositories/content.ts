import { and, asc, count, desc, eq, gte, lt } from 'drizzle-orm';

import type { Database, DbExecutor } from '../client';
import {
  contentActivations,
  contentDrafts,
  contentReleases,
  realmActiveContent,
  type ContentActivation,
  type ContentDraft,
  type ContentRelease,
} from '../schema/content';
import { realms } from '../schema/realms';

export async function listContentDrafts(db: Database): Promise<ContentDraft[]> {
  return db.select().from(contentDrafts).orderBy(asc(contentDrafts.section));
}

export async function findContentDraft(
  db: Database,
  section: ContentDraft['section'],
): Promise<ContentDraft | undefined> {
  const [row] = await db
    .select()
    .from(contentDrafts)
    .where(eq(contentDrafts.section, section))
    .limit(1);
  return row;
}

export type UpsertContentDraftInput = {
  section: ContentDraft['section'];
  payload: unknown;
  adminUserId: string;
  adminUsername: string;
  now: Date;
};

export async function upsertContentDraft(
  executor: DbExecutor,
  input: UpsertContentDraftInput,
): Promise<ContentDraft> {
  const [row] = await executor
    .insert(contentDrafts)
    .values({
      section: input.section,
      payload: input.payload,
      updatedBy: input.adminUserId,
      updatedByUsername: input.adminUsername,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: contentDrafts.section,
      set: {
        payload: input.payload,
        updatedBy: input.adminUserId,
        updatedByUsername: input.adminUsername,
        updatedAt: input.now,
      },
    })
    .returning();
  if (row === undefined) {
    throw new Error('failed to save content draft');
  }
  return row;
}

export async function deleteContentDraft(
  db: Database,
  section: ContentDraft['section'],
): Promise<void> {
  await db.delete(contentDrafts).where(eq(contentDrafts.section, section));
}

export type InsertContentReleaseInput = {
  version: string;
  schemaVersion: number;
  checksum: string;
  payload: unknown;
  changeSummary: unknown;
  createdBy: string;
  createdByUsername: string;
  note: string | null;
  createdAt: Date;
};

export async function insertContentRelease(
  executor: DbExecutor,
  input: InsertContentReleaseInput,
): Promise<ContentRelease> {
  const [row] = await executor.insert(contentReleases).values(input).returning();
  if (row === undefined) {
    throw new Error('failed to insert content release');
  }
  return row;
}

export async function listContentReleases(db: Database, limit: number): Promise<ContentRelease[]> {
  return db.select().from(contentReleases).orderBy(desc(contentReleases.createdAt)).limit(limit);
}

export async function findContentReleaseById(
  db: Database,
  id: string,
): Promise<ContentRelease | undefined> {
  const [row] = await db.select().from(contentReleases).where(eq(contentReleases.id, id)).limit(1);
  return row;
}

export async function countReleasesCreatedBetween(
  db: Database,
  start: Date,
  end: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(contentReleases)
    .where(and(gte(contentReleases.createdAt, start), lt(contentReleases.createdAt, end)));
  return row?.total ?? 0;
}

export type ActiveContentRecord = {
  realmId: string;
  release: ContentRelease;
  activatedByUsername: string;
  reason: string;
  updatedAt: Date;
};

export async function findRealmActiveContent(
  db: Database,
  realmId: string,
): Promise<ActiveContentRecord | undefined> {
  const [row] = await db
    .select({
      realmId: realmActiveContent.realmId,
      release: contentReleases,
      activatedByUsername: realmActiveContent.activatedByUsername,
      reason: realmActiveContent.reason,
      updatedAt: realmActiveContent.updatedAt,
    })
    .from(realmActiveContent)
    .innerJoin(contentReleases, eq(realmActiveContent.contentReleaseId, contentReleases.id))
    .where(eq(realmActiveContent.realmId, realmId))
    .limit(1);
  return row;
}

/**
 * The game server fixes one release per Room. In the MVP there is a single
 * active realm; this returns its release (ADR-022 future work binds Rooms to
 * realms explicitly).
 */
export async function findDefaultActiveRelease(
  db: Database,
): Promise<ActiveContentRecord | undefined> {
  const [row] = await db
    .select({
      realmId: realmActiveContent.realmId,
      release: contentReleases,
      activatedByUsername: realmActiveContent.activatedByUsername,
      reason: realmActiveContent.reason,
      updatedAt: realmActiveContent.updatedAt,
    })
    .from(realmActiveContent)
    .innerJoin(contentReleases, eq(realmActiveContent.contentReleaseId, contentReleases.id))
    .innerJoin(realms, eq(realmActiveContent.realmId, realms.id))
    .where(eq(realms.status, 'active'))
    .orderBy(asc(realms.code))
    .limit(1);
  return row;
}

export async function findLatestActivation(
  db: Database,
  realmId: string,
): Promise<ContentActivation | undefined> {
  const [row] = await db
    .select()
    .from(contentActivations)
    .where(eq(contentActivations.realmId, realmId))
    .orderBy(desc(contentActivations.createdAt))
    .limit(1);
  return row;
}

export async function listContentActivations(
  db: Database,
  realmId: string,
  limit: number,
): Promise<ContentActivation[]> {
  return db
    .select()
    .from(contentActivations)
    .where(eq(contentActivations.realmId, realmId))
    .orderBy(desc(contentActivations.createdAt))
    .limit(limit);
}

export type ActivateContentInput = {
  realmId: string;
  releaseId: string;
  adminUserId: string;
  adminUsername: string;
  reason: string;
  now: Date;
};

/** Appends activation history and points the realm at the release atomically. */
export async function activateContentRelease(
  executor: DbExecutor,
  input: ActivateContentInput,
): Promise<ContentActivation> {
  const [activation] = await executor
    .insert(contentActivations)
    .values({
      realmId: input.realmId,
      contentReleaseId: input.releaseId,
      activatedBy: input.adminUserId,
      activatedByUsername: input.adminUsername,
      reason: input.reason,
      createdAt: input.now,
    })
    .returning();
  if (activation === undefined) {
    throw new Error('failed to record content activation');
  }
  await executor
    .insert(realmActiveContent)
    .values({
      realmId: input.realmId,
      contentReleaseId: input.releaseId,
      activatedBy: input.adminUserId,
      activatedByUsername: input.adminUsername,
      reason: input.reason,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: realmActiveContent.realmId,
      set: {
        contentReleaseId: input.releaseId,
        activatedBy: input.adminUserId,
        activatedByUsername: input.adminUsername,
        reason: input.reason,
        updatedAt: input.now,
      },
    });
  return activation;
}
