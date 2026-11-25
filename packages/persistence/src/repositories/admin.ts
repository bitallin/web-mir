import { and, eq, gt, isNull } from 'drizzle-orm';

import type { Database, DbExecutor } from '../client';
import { adminSessions, adminUsers, type AdminSession, type AdminUser } from '../schema/admin';

export type AdminRoleId = AdminUser['role'];

export type CreateAdminUserInput = {
  username: string;
  usernameNormalized: string;
  passwordHash: string;
  role: AdminRoleId;
};

export async function insertAdminUser(
  db: DbExecutor,
  input: CreateAdminUserInput,
): Promise<AdminUser> {
  const [row] = await db.insert(adminUsers).values(input).returning();
  if (row === undefined) {
    throw new Error('failed to insert admin user');
  }
  return row;
}

export async function findAdminByNormalizedUsername(
  db: Database,
  usernameNormalized: string,
): Promise<AdminUser | undefined> {
  const [row] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.usernameNormalized, usernameNormalized))
    .limit(1);
  return row;
}

export async function findAdminById(db: Database, id: string): Promise<AdminUser | undefined> {
  const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
  return row;
}

export async function touchAdminLogin(db: Database, adminUserId: string, now: Date): Promise<void> {
  await db
    .update(adminUsers)
    .set({ lastLoginAt: now, updatedAt: now })
    .where(eq(adminUsers.id, adminUserId));
}

export type InsertAdminSessionInput = {
  adminUserId: string;
  tokenHash: string;
  expiresAt: Date;
};

export async function insertAdminSession(
  db: Database,
  input: InsertAdminSessionInput,
): Promise<AdminSession> {
  const [row] = await db.insert(adminSessions).values(input).returning();
  if (row === undefined) {
    throw new Error('failed to insert admin session');
  }
  return row;
}

export type ActiveAdminSession = {
  session: AdminSession;
  admin: AdminUser;
};

export async function findAdminSessionByTokenHash(
  db: Database,
  tokenHash: string,
  now: Date,
): Promise<ActiveAdminSession | undefined> {
  const [row] = await db
    .select({ session: adminSessions, admin: adminUsers })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminSessions.adminUserId, adminUsers.id))
    .where(
      and(
        eq(adminSessions.tokenHash, tokenHash),
        isNull(adminSessions.revokedAt),
        gt(adminSessions.expiresAt, now),
      ),
    )
    .limit(1);
  return row;
}

export async function revokeAdminSessionByTokenHash(
  db: Database,
  tokenHash: string,
  now: Date,
): Promise<void> {
  await db
    .update(adminSessions)
    .set({ revokedAt: now })
    .where(and(eq(adminSessions.tokenHash, tokenHash), isNull(adminSessions.revokedAt)));
}
