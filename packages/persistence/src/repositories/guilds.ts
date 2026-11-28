import { and, asc, count, desc, eq, ne, sql } from 'drizzle-orm';

import type { DbExecutor } from '../client';
import {
  characters,
  guildApplications,
  guildMembers,
  guilds,
  type Guild,
  type GuildApplication,
  type GuildRoleId,
} from '../schema/index';

export type GuildMemberProfile = {
  characterId: string;
  name: string;
  classId: string;
  level: number;
  role: GuildRoleId;
  joinedAt: Date;
};

export type CharacterGuild = {
  guild: Guild;
  role: GuildRoleId;
  joinedAt: Date;
};

export type InsertGuildInput = {
  realmId: string;
  name: string;
  nameNormalized: string;
  createdAt: Date;
};

export async function insertGuild(
  executor: DbExecutor,
  input: InsertGuildInput,
): Promise<Guild | undefined> {
  const [row] = await executor.insert(guilds).values(input).returning();
  return row;
}

export async function findGuildById(
  executor: DbExecutor,
  guildId: string,
): Promise<Guild | undefined> {
  const [row] = await executor.select().from(guilds).where(eq(guilds.id, guildId)).limit(1);
  return row;
}

/** Locks the guild row so concurrent joins cannot overfill it. */
export async function lockGuildById(
  executor: DbExecutor,
  guildId: string,
): Promise<Guild | undefined> {
  const [row] = await executor
    .select()
    .from(guilds)
    .where(eq(guilds.id, guildId))
    .limit(1)
    .for('update');
  return row;
}

export async function findGuildByNormalizedName(
  executor: DbExecutor,
  realmId: string,
  nameNormalized: string,
): Promise<Guild | undefined> {
  const [row] = await executor
    .select()
    .from(guilds)
    .where(and(eq(guilds.realmId, realmId), eq(guilds.nameNormalized, nameNormalized)))
    .limit(1);
  return row;
}

export async function insertGuildMember(
  executor: DbExecutor,
  input: {
    guildId: string;
    characterId: string;
    role: GuildRoleId;
    joinedAt: Date;
  },
): Promise<void> {
  await executor.insert(guildMembers).values(input);
}

export async function findGuildMembership(
  executor: DbExecutor,
  characterId: string,
): Promise<CharacterGuild | undefined> {
  const [row] = await executor
    .select({
      guild: guilds,
      role: guildMembers.role,
      joinedAt: guildMembers.joinedAt,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .where(eq(guildMembers.characterId, characterId))
    .limit(1);
  return row;
}

export async function listGuildMembers(
  executor: DbExecutor,
  guildId: string,
): Promise<GuildMemberProfile[]> {
  return executor
    .select({
      characterId: guildMembers.characterId,
      name: characters.name,
      classId: characters.classId,
      level: characters.level,
      role: guildMembers.role,
      joinedAt: guildMembers.joinedAt,
    })
    .from(guildMembers)
    .innerJoin(characters, eq(characters.id, guildMembers.characterId))
    .where(eq(guildMembers.guildId, guildId))
    .orderBy(asc(guildMembers.joinedAt), asc(guildMembers.characterId));
}

export async function listGuildMemberIds(executor: DbExecutor, guildId: string): Promise<string[]> {
  const rows = await executor
    .select({ characterId: guildMembers.characterId })
    .from(guildMembers)
    .where(eq(guildMembers.guildId, guildId));
  return rows.map((row) => row.characterId);
}

export async function countGuildMembers(executor: DbExecutor, guildId: string): Promise<number> {
  const [row] = await executor
    .select({ value: count() })
    .from(guildMembers)
    .where(eq(guildMembers.guildId, guildId));
  return Number(row?.value ?? 0);
}

/** The earliest remaining member inherits leadership when the leader leaves. */
export async function findOldestGuildMemberId(
  executor: DbExecutor,
  guildId: string,
  excludeCharacterId?: string,
): Promise<string | undefined> {
  const [row] = await executor
    .select({ characterId: guildMembers.characterId })
    .from(guildMembers)
    .where(
      excludeCharacterId === undefined
        ? eq(guildMembers.guildId, guildId)
        : and(eq(guildMembers.guildId, guildId), ne(guildMembers.characterId, excludeCharacterId)),
    )
    .orderBy(asc(guildMembers.joinedAt), asc(guildMembers.characterId))
    .limit(1);
  return row?.characterId;
}

export async function updateGuildMemberRole(
  executor: DbExecutor,
  guildId: string,
  characterId: string,
  role: GuildRoleId,
): Promise<void> {
  await executor
    .update(guildMembers)
    .set({ role })
    .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.characterId, characterId)));
}

export async function deleteGuildMember(
  executor: DbExecutor,
  guildId: string,
  characterId: string,
): Promise<boolean> {
  const rows = await executor
    .delete(guildMembers)
    .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.characterId, characterId)))
    .returning({ characterId: guildMembers.characterId });
  return rows.length > 0;
}

/** Membership rows cascade with the guild. */
export async function deleteGuildById(executor: DbExecutor, guildId: string): Promise<boolean> {
  const rows = await executor
    .delete(guilds)
    .where(eq(guilds.id, guildId))
    .returning({ id: guilds.id });
  return rows.length > 0;
}

export type GuildApplicationProfile = {
  applicationId: string;
  characterId: string;
  name: string;
  classId: string;
  level: number;
  createdAt: Date;
};

export type GuildSummary = {
  guildId: string;
  name: string;
  leaderName: string | null;
  memberCount: number;
  createdAt: Date;
};

export async function insertGuildApplication(
  executor: DbExecutor,
  input: { guildId: string; characterId: string; createdAt: Date },
): Promise<GuildApplication | undefined> {
  const [row] = await executor
    .insert(guildApplications)
    .values(input)
    .onConflictDoNothing({
      target: [guildApplications.guildId, guildApplications.characterId],
    })
    .returning();
  return row;
}

export async function findGuildApplication(
  executor: DbExecutor,
  guildId: string,
  characterId: string,
): Promise<GuildApplication | undefined> {
  const [row] = await executor
    .select()
    .from(guildApplications)
    .where(
      and(eq(guildApplications.guildId, guildId), eq(guildApplications.characterId, characterId)),
    )
    .limit(1);
  return row;
}

export async function findGuildApplicationById(
  executor: DbExecutor,
  applicationId: string,
): Promise<GuildApplication | undefined> {
  const [row] = await executor
    .select()
    .from(guildApplications)
    .where(eq(guildApplications.id, applicationId))
    .limit(1);
  return row;
}

/** Leader-facing list; capped by the caller's wire limit. */
export async function listGuildApplications(
  executor: DbExecutor,
  guildId: string,
  limit: number,
): Promise<GuildApplicationProfile[]> {
  return executor
    .select({
      applicationId: guildApplications.id,
      characterId: guildApplications.characterId,
      name: characters.name,
      classId: characters.classId,
      level: characters.level,
      createdAt: guildApplications.createdAt,
    })
    .from(guildApplications)
    .innerJoin(characters, eq(characters.id, guildApplications.characterId))
    .where(eq(guildApplications.guildId, guildId))
    .orderBy(asc(guildApplications.createdAt), asc(guildApplications.id))
    .limit(limit);
}

/** Guild ids this character has applied to; used to mark the directory. */
export async function listGuildApplicationGuildIds(
  executor: DbExecutor,
  characterId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ guildId: guildApplications.guildId })
    .from(guildApplications)
    .where(eq(guildApplications.characterId, characterId));
  return rows.map((row) => row.guildId);
}

export async function deleteGuildApplication(
  executor: DbExecutor,
  applicationId: string,
): Promise<boolean> {
  const rows = await executor
    .delete(guildApplications)
    .where(eq(guildApplications.id, applicationId))
    .returning({ id: guildApplications.id });
  return rows.length > 0;
}

/** Accepting one guild or joining elsewhere clears every other application. */
export async function deleteGuildApplicationsForCharacter(
  executor: DbExecutor,
  characterId: string,
): Promise<number> {
  const rows = await executor
    .delete(guildApplications)
    .where(eq(guildApplications.characterId, characterId))
    .returning({ id: guildApplications.id });
  return rows.length;
}

/**
 * Public realm directory: one aggregate row per guild, ordered by size then
 * age. The roster and online state are deliberately not exposed (ADR-049).
 */
export async function listGuildSummaries(
  executor: DbExecutor,
  realmId: string,
  limit: number,
): Promise<GuildSummary[]> {
  const rows = await executor
    .select({
      guildId: guilds.id,
      name: guilds.name,
      createdAt: guilds.createdAt,
      memberCount: count(guildMembers.characterId),
      leaderName: sql<
        string | null
      >`max(case when ${guildMembers.role} = 'leader' then ${characters.name} end)`,
    })
    .from(guilds)
    .leftJoin(guildMembers, eq(guildMembers.guildId, guilds.id))
    .leftJoin(characters, eq(characters.id, guildMembers.characterId))
    .where(eq(guilds.realmId, realmId))
    .groupBy(guilds.id, guilds.name, guilds.createdAt)
    .orderBy(desc(count(guildMembers.characterId)), asc(guilds.createdAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, memberCount: Number(row.memberCount) }));
}

export async function findGuildLeader(
  executor: DbExecutor,
  guildId: string,
): Promise<{ characterId: string; name: string } | undefined> {
  const [row] = await executor
    .select({ characterId: guildMembers.characterId, name: characters.name })
    .from(guildMembers)
    .innerJoin(characters, eq(characters.id, guildMembers.characterId))
    .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.role, 'leader')))
    .limit(1);
  return row;
}
