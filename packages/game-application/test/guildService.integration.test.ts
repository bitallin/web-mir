import { randomUUID } from 'node:crypto';

import {
  createDatabase,
  findGuildById,
  insertAccount,
  insertCharacter,
  realms,
  type CharacterClassId,
  type Database,
  type DatabaseHandle,
} from '@web-legend/persistence';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GuildService } from '../src/index';

const databaseUrl = process.env.DATABASE_URL;
const REALM_CODE = 'classic-01';
const SECOND_REALM_CODE = 'guild-test-02';
const PASSWORD_HASH = 'guild-test-hash';

function requireDatabaseUrl(): string {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required for guild application integration tests');
  }
  return databaseUrl;
}

let sequence = 0;

function suffix(): string {
  sequence += 1;
  return `${randomUUID().replace(/-/gu, '').slice(0, 6)}${sequence.toString(36)}`;
}

async function realmIdOf(db: Database, code = REALM_CODE): Promise<string> {
  const [realm] = await db.select().from(realms).where(eq(realms.code, code)).limit(1);
  if (realm === undefined) {
    throw new Error(`test realm "${code}" is missing`);
  }
  return realm.id;
}

async function createCharacter(
  db: Database,
  options: { classId?: CharacterClassId; level?: number; realmCode?: string } = {},
) {
  const token = suffix();
  const account = await insertAccount(db, {
    username: `guild_${token}`.slice(0, 24),
    usernameNormalized: `guild_${token}`.slice(0, 24),
    passwordHash: PASSWORD_HASH,
  });
  return insertCharacter(db, {
    accountId: account.id,
    realmId: await realmIdOf(db, options.realmCode ?? REALM_CODE),
    name: `G${token}`.slice(0, 12),
    nameNormalized: `g${token}`.slice(0, 12).toLowerCase(),
    classId: options.classId ?? 'warrior',
    level: options.level ?? 6,
    exp: 0,
    hp: 100,
    maxHp: 100,
    mp: 30,
    maxMp: 30,
    mapId: 'starter_wilds',
    x: 7_500,
    y: 15_500,
    facing: 2,
  });
}

async function expectSocialError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'SocialError', code });
}

describe.runIf(databaseUrl !== undefined)('GuildService with PostgreSQL', () => {
  let handle: DatabaseHandle;
  let db: Database;
  let service: GuildService;

  beforeAll(async () => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to run database-mutating tests with NODE_ENV=production');
    }
    handle = createDatabase(requireDatabaseUrl(), { max: 5 });
    db = handle.db;
    await db
      .insert(realms)
      .values([
        { code: REALM_CODE, name: '经典一区', status: 'active' },
        { code: SECOND_REALM_CODE, name: '行会测试二区', status: 'active' },
      ])
      .onConflictDoNothing({ target: realms.code });
    service = new GuildService(db, { memberLimit: 3 });
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('creates a guild with its creator as leader and rejects invalid names', async () => {
    const leader = await createCharacter(db);
    const record = await service.create(leader.id, '  黎明之刃  ');
    expect(record.name).toBe('黎明之刃');
    expect(record.leaderId).toBe(leader.id);
    expect(record.members).toHaveLength(1);
    expect(record.members[0]?.leader).toBe(true);
    expect(record.members[0]?.displayName).toBe(leader.name);

    const view = await service.view(leader.id);
    expect(view?.guildId).toBe(record.guildId);

    await expectSocialError(service.create(leader.id, '另一个行会'), 'GUILD_ALREADY_IN_GUILD');

    const other = await createCharacter(db);
    await expectSocialError(service.create(other.id, '黎明之刃'), 'GUILD_NAME_TAKEN');
  });

  it('requires the creation level and scopes names per realm', async () => {
    const low = await createCharacter(db, { level: 4 });
    await expectSocialError(service.create(low.id, '低等级行会'), 'GUILD_LEVEL_TOO_LOW');

    const first = await createCharacter(db);
    await service.create(first.id, '跨区同名');
    const otherRealm = await createCharacter(db, { realmCode: SECOND_REALM_CODE });
    const second = await service.create(otherRealm.id, '跨区同名');
    expect(second.guildId).not.toBe((await service.membership(first.id))?.guild.id);
  });

  it('lets only the leader invite eligible players', async () => {
    const leader = await createCharacter(db);
    const member = await createCharacter(db);
    const outsider = await createCharacter(db);
    const guild = await service.create(leader.id, '受邀者行会');
    await service.join(guild.guildId, member.id);

    await expectSocialError(service.inviteFacts(member.id, outsider.id), 'GUILD_NOT_LEADER');
    await expectSocialError(service.inviteFacts(leader.id, leader.id), 'GUILD_TARGET_SELF');
    await expectSocialError(service.inviteFacts(leader.id, member.id), 'GUILD_TARGET_IN_GUILD');

    const facts = await service.inviteFacts(leader.id, outsider.id);
    expect(facts.guildId).toBe(guild.guildId);
    expect(facts.targetName).toBe(outsider.name);

    const foreign = await createCharacter(db, { realmCode: SECOND_REALM_CODE });
    await expectSocialError(service.inviteFacts(leader.id, foreign.id), 'GUILD_TARGET_UNAVAILABLE');
  });

  it('joins under a row lock and never exceeds the member limit', async () => {
    const leader = await createCharacter(db);
    const first = await createCharacter(db);
    const second = await createCharacter(db);
    const third = await createCharacter(db);
    const guild = await service.create(leader.id, '满员行会');
    await service.join(guild.guildId, first.id);
    await service.join(guild.guildId, second.id);

    await expectSocialError(service.join(guild.guildId, first.id), 'GUILD_ALREADY_IN_GUILD');
    await expectSocialError(service.join(guild.guildId, third.id), 'GUILD_FULL');
    await expectSocialError(
      service.join('018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d99', third.id),
      'GUILD_NOT_FOUND',
    );
  });

  it('converges concurrent joins to one membership when the guild is full', async () => {
    const leader = await createCharacter(db);
    const first = await createCharacter(db);
    const second = await createCharacter(db);
    const guild = await service.create(leader.id, '并发入会');
    // The limit is 3, so two free seats remain and both joins must succeed.
    const results = await Promise.allSettled([
      service.join(guild.guildId, first.id),
      service.join(guild.guildId, second.id),
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect((await service.view(leader.id))?.members).toHaveLength(3);
  });

  it('hands leadership to the earliest remaining member and deletes empty guilds', async () => {
    const leader = await createCharacter(db);
    const first = await createCharacter(db);
    const leaderGuild = await service.create(leader.id, '转让行会');
    await service.join(leaderGuild.guildId, first.id);

    const left = await service.leave(leader.id);
    expect(left.disbanded).toBe(false);
    expect(left.newLeaderId).toBe(first.id);
    expect(left.memberIds).toEqual([leader.id, first.id]);
    const afterTransfer = await service.view(first.id);
    expect(afterTransfer?.leaderId).toBe(first.id);
    expect(afterTransfer?.members.find((member) => member.playerId === first.id)?.leader).toBe(
      true,
    );

    const last = await service.leave(first.id);
    expect(last.disbanded).toBe(true);
    expect(await findGuildById(db, leaderGuild.guildId)).toBeUndefined();
    expect(await service.view(first.id)).toBeNull();
  });

  it('kicks members only as leader and disbands only as leader', async () => {
    const leader = await createCharacter(db);
    const member = await createCharacter(db);
    const outsider = await createCharacter(db);
    const guild = await service.create(leader.id, '权限行会');
    await service.join(guild.guildId, member.id);

    await expectSocialError(service.kick(member.id, leader.id), 'GUILD_NOT_LEADER');
    await expectSocialError(service.kick(leader.id, outsider.id), 'GUILD_TARGET_NOT_MEMBER');
    await expectSocialError(service.kick(leader.id, leader.id), 'GUILD_TARGET_SELF');
    await expectSocialError(service.disband(member.id), 'GUILD_NOT_LEADER');

    const kicked = await service.kick(leader.id, member.id);
    expect(kicked.kickedId).toBe(member.id);
    expect(kicked.memberIds).toEqual([member.id, leader.id]);
    expect(await service.view(member.id)).toBeNull();

    await service.join(guild.guildId, member.id);
    const disbanded = await service.disband(leader.id);
    expect(disbanded.memberIds).toHaveLength(2);
    expect(await findGuildById(db, guild.guildId)).toBeUndefined();
    expect(await service.view(leader.id)).toBeNull();
  });

  it('reports chat recipients and online guildmates from membership', async () => {
    const leader = await createCharacter(db);
    const member = await createCharacter(db);
    const outsider = await createCharacter(db);
    const guild = await service.create(leader.id, '频道行会');
    await service.join(guild.guildId, member.id);

    expect(await service.chatRecipients(leader.id)).toHaveLength(2);
    expect(await service.chatRecipients(outsider.id)).toBeNull();
    expect(await service.guildmateIds(leader.id)).toEqual([member.id]);
    expect(await service.guildmateIds(outsider.id)).toEqual([]);
  });
});
