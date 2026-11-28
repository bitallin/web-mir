import { and, asc, count, eq, ne } from 'drizzle-orm';

import type { DbExecutor } from '../client';
import { characters, guildMembers, guilds, type Guild, type GuildRoleId } from '../schema/index';

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
