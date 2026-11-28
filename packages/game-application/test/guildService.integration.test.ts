import { randomUUID } from 'node:crypto';

import {
  createDatabase,
  findGuildById,
  insertAccount,
  insertCharacter,
  insertGuildApplication,
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

  it('lists realm guilds with leader, size and the applicant flag', async () => {
    const leader = await createCharacter(db);
    const member = await createCharacter(db);
    const applicant = await createCharacter(db);
    const guild = await service.create(leader.id, '目录行会');
    await service.join(guild.guildId, member.id);

    const before = await service.directory(applicant.id);
    const summary = before.guilds.find((row) => row.guildId === guild.guildId);
    expect(summary).toMatchObject({
      name: '目录行会',
      leaderName: leader.name,
      memberCount: 2,
      memberLimit: 3,
      applied: false,
    });

    await service.apply(applicant.id, guild.guildId);
    const after = await service.directory(applicant.id);
    expect(after.guilds.find((row) => row.guildId === guild.guildId)?.applied).toBe(true);
  });

  it('accepts applications from multiple guilds and cleans them on join', async () => {
    const leaderA = await createCharacter(db);
    const leaderB = await createCharacter(db);
    const applicant = await createCharacter(db);
    const guildA = await service.create(leaderA.id, '甲行会');
    const guildB = await service.create(leaderB.id, '乙行会');

    await service.apply(applicant.id, guildA.guildId);
    await service.apply(applicant.id, guildB.guildId);
    // Repeating one application is idempotent.
    await service.apply(applicant.id, guildA.guildId);
    expect(await service.applications(leaderA.id)).toHaveLength(1);
    expect(await service.applications(leaderB.id)).toHaveLength(1);
    const appliedDirectory = await service.directory(applicant.id);
    expect(appliedDirectory.guilds.find((row) => row.guildId === guildA.guildId)?.applied).toBe(
      true,
    );
    expect(appliedDirectory.guilds.find((row) => row.guildId === guildB.guildId)?.applied).toBe(
      true,
    );

    const [application] = await service.applications(leaderA.id);
    const accepted = await service.acceptApplication(leaderA.id, application!.applicationId);
    expect(accepted.applicantId).toBe(applicant.id);
    expect(accepted.memberIds).toEqual(expect.arrayContaining([leaderA.id, applicant.id]));

    // Joining one guild withdraws the other application.
    expect(await service.applications(leaderB.id)).toEqual([]);
    const directory = await service.directory(applicant.id);
    expect(directory.guilds.every((row) => row.applied === false)).toBe(true);
    expect(await service.view(applicant.id)).not.toBeNull();
  });

  it('rejects applications from guilded players, to full guilds, and across realms', async () => {
    const leader = await createCharacter(db);
    const first = await createCharacter(db);
    const second = await createCharacter(db);
    const third = await createCharacter(db);
    const guild = await service.create(leader.id, '满员申请');
    await service.join(guild.guildId, first.id);
    await service.join(guild.guildId, second.id);

    await expectSocialError(service.apply(third.id, guild.guildId), 'GUILD_FULL');
    await expectSocialError(service.apply(leader.id, guild.guildId), 'GUILD_ALREADY_IN_GUILD');

    const foreignLeader = await createCharacter(db, { realmCode: SECOND_REALM_CODE });
    const foreignGuild = await service.create(foreignLeader.id, '异区行会');
    await expectSocialError(service.apply(third.id, foreignGuild.guildId), 'GUILD_NOT_FOUND');
  });

  it('accepts only as leader, under the member limit, and declines cleanly', async () => {
    const leader = await createCharacter(db);
    const member = await createCharacter(db);
    const applicant = await createCharacter(db);
    const otherApplicant = await createCharacter(db);
    const guild = await service.create(leader.id, '审批行会');
    await service.join(guild.guildId, member.id);
    await service.apply(applicant.id, guild.guildId);

    const application = (await service.applications(leader.id))[0]!;
    await expectSocialError(
      service.acceptApplication(member.id, application.applicationId),
      'GUILD_NOT_LEADER',
    );
    await expectSocialError(
      service.acceptApplication(leader.id, '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d99'),
      'GUILD_APPLICATION_NOT_FOUND',
    );

    const accepted = await service.acceptApplication(leader.id, application.applicationId);
    expect(accepted.applicantName).toBe(applicant.name);
    expect(await service.applications(leader.id)).toEqual([]);

    // The guild is now full; a new application can be declined but not accepted.
    expect((await service.view(leader.id))?.members).toHaveLength(3);
    await expectSocialError(service.apply(otherApplicant.id, guild.guildId), 'GUILD_FULL');

    const second = await createCharacter(db);
    const secondMember = await createCharacter(db);
    const secondGuild = await service.create(second.id, '拒绝行会');
    await service.join(secondGuild.guildId, secondMember.id);
    await service.apply(otherApplicant.id, secondGuild.guildId);
    const secondApplication = (await service.applications(second.id))[0]!;
    await expectSocialError(
      service.declineApplication(secondMember.id, secondApplication.applicationId),
      'GUILD_NOT_LEADER',
    );
    const declined = await service.declineApplication(second.id, secondApplication.applicationId);
    expect(declined.applicantId).toBe(otherApplicant.id);
    expect(await service.applications(second.id)).toEqual([]);
    await expectSocialError(
      service.declineApplication(second.id, secondApplication.applicationId),
      'GUILD_APPLICATION_NOT_FOUND',
    );
  });

  it('removes a stale application when the applicant already joined elsewhere', async () => {
    const leaderA = await createCharacter(db);
    const leaderB = await createCharacter(db);
    const applicant = await createCharacter(db);
    const guildA = await service.create(leaderA.id, '旧申请甲');
    const guildB = await service.create(leaderB.id, '旧申请乙');
    await service.apply(applicant.id, guildA.guildId);
    await service.join(guildB.guildId, applicant.id);

    // Simulate the race the accept path defends against: the applicant joined
    // another guild while this request was still pending in the database.
    await insertGuildApplication(db, {
      guildId: guildA.guildId,
      characterId: applicant.id,
      createdAt: new Date(),
    });
    const stale = (await service.applications(leaderA.id))[0]!;
    await expectSocialError(
      service.acceptApplication(leaderA.id, stale.applicationId),
      'GUILD_ALREADY_IN_GUILD',
    );
    expect(await service.applications(leaderA.id)).toEqual([]);
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
