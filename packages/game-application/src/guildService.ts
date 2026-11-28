import type { CharacterClass } from '@web-legend/contracts';
import {
  GUILD_APPLICATION_LIST_MAX,
  GUILD_CREATE_MIN_LEVEL,
  GUILD_DIRECTORY_MAX,
  GUILD_MEMBER_LIMIT,
  normalizeGuildName,
} from '@web-legend/contracts';
import {
  countGuildMembers,
  deleteGuildApplication,
  deleteGuildApplicationsForCharacter,
  deleteGuildById,
  deleteGuildMember,
  findCharacterById,
  findGuildApplication,
  findGuildApplicationById,
  findGuildById,
  findGuildByNormalizedName,
  findGuildLeader,
  findGuildMembership,
  findOldestGuildMemberId,
  insertGuild,
  insertGuildApplication,
  insertGuildMember,
  isUniqueViolation,
  listGuildApplicationGuildIds,
  listGuildApplications,
  listGuildMemberIds,
  listGuildMembers,
  listGuildSummaries,
  lockGuildById,
  updateGuildMemberRole,
  type Database,
  type DbExecutor,
  type Guild,
  type GuildMemberProfile,
  type GuildRoleId,
} from '@web-legend/persistence';

import { SocialError } from './errors';

export type GuildMemberRecord = {
  playerId: string;
  displayName: string;
  classId: CharacterClass;
  level: number;
  leader: boolean;
  joinedAt: number;
};

/** Database facts only; the room merges process-wide presence into these. */
export type GuildRecord = {
  guildId: string;
  name: string;
  leaderId: string;
  memberLimit: number;
  members: GuildMemberRecord[];
};

export type GuildInviteFacts = {
  guildId: string;
  guildName: string;
  realmId: string;
  targetName: string;
};

export type GuildLeaveOutcome = {
  guildId: string;
  memberIds: string[];
  disbanded: boolean;
  newLeaderId: string | null;
};

export type GuildKickOutcome = {
  guildId: string;
  memberIds: string[];
  kickedId: string;
};

export type GuildDisbandOutcome = {
  guildId: string;
  memberIds: string[];
};

export type GuildSummaryRecord = {
  guildId: string;
  name: string;
  leaderName: string;
  memberCount: number;
  memberLimit: number;
  applied: boolean;
};

export type GuildDirectoryRecord = {
  guilds: GuildSummaryRecord[];
};

export type GuildApplicationRecord = {
  applicationId: string;
  playerId: string;
  displayName: string;
  classId: CharacterClass;
  level: number;
  createdAt: number;
};

export type GuildApplyOutcome = {
  guildId: string;
  guildName: string;
  leaderId: string;
  characterName: string;
};

export type GuildApplicationAcceptOutcome = {
  guildId: string;
  guildName: string;
  memberIds: string[];
  applicantId: string;
  applicantName: string;
};

export type GuildApplicationDeclineOutcome = {
  guildId: string;
  guildName: string;
  applicantId: string;
  applicantName: string;
};

export type GuildServiceOptions = {
  now?: () => Date;
  memberLimit?: number;
  createMinLevel?: number;
};

/**
 * Persistent guild membership (ADR-048). Every membership change runs in one
 * transaction that locks the guild row, so concurrent joins cannot overfill and
 * leadership hand-over cannot race a second leader into existence.
 */
export class GuildService {
  private readonly now: () => Date;
  private readonly memberLimit: number;
  private readonly createMinLevel: number;

  constructor(
    private readonly database: Database,
    options: GuildServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.memberLimit = options.memberLimit ?? GUILD_MEMBER_LIMIT;
    this.createMinLevel = options.createMinLevel ?? GUILD_CREATE_MIN_LEVEL;
  }

  get maxMembers(): number {
    return this.memberLimit;
  }

  async membership(characterId: string): Promise<{ guild: Guild; role: GuildRoleId } | undefined> {
    const row = await findGuildMembership(this.database, characterId);
    return row === undefined ? undefined : { guild: row.guild, role: row.role };
  }

  async view(characterId: string): Promise<GuildRecord | null> {
    const membership = await findGuildMembership(this.database, characterId);
    if (membership === undefined) {
      return null;
    }
    return this.viewOf(membership.guild);
  }

  async create(characterId: string, rawName: string): Promise<GuildRecord> {
    const name = rawName.normalize('NFKC').trim();
    const character = await findCharacterById(this.database, characterId);
    if (character === undefined) {
      throw new SocialError('INVALID_SESSION');
    }
    if (character.level < this.createMinLevel) {
      throw new SocialError('GUILD_LEVEL_TOO_LOW');
    }
    if ((await findGuildMembership(this.database, characterId)) !== undefined) {
      throw new SocialError('GUILD_ALREADY_IN_GUILD');
    }

    try {
      const guild = await this.database.transaction(async (tx) => {
        const created = await insertGuild(tx, {
          realmId: character.realmId,
          name,
          nameNormalized: normalizeGuildName(name),
          createdAt: this.now(),
        });
        if (created === undefined) {
          throw new SocialError('SERVICE_UNAVAILABLE');
        }
        await insertGuildMember(tx, {
          guildId: created.id,
          characterId,
          role: 'leader',
          joinedAt: this.now(),
        });
        // A character that creates a guild is no longer looking for one.
        await deleteGuildApplicationsForCharacter(tx, characterId);
        return created;
      });
      const record = await this.viewOf(guild);
      if (record === null) {
        throw new SocialError('SERVICE_UNAVAILABLE');
      }
      return record;
    } catch (error) {
      if (error instanceof SocialError) {
        throw error;
      }
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // Either the realm already has this name or another request made this
      // character a member first; report the fact that is now true.
      if ((await findGuildMembership(this.database, characterId)) !== undefined) {
        throw new SocialError('GUILD_ALREADY_IN_GUILD');
      }
      const taken = await findGuildByNormalizedName(
        this.database,
        character.realmId,
        normalizeGuildName(name),
      );
      throw new SocialError(taken === undefined ? 'SERVICE_UNAVAILABLE' : 'GUILD_NAME_TAKEN');
    }
  }

  /** Invite eligibility that lives in the database; online state is the room's job. */
  async inviteFacts(actorId: string, targetId: string): Promise<GuildInviteFacts> {
    if (actorId === targetId) {
      throw new SocialError('GUILD_TARGET_SELF');
    }
    const actor = await findGuildMembership(this.database, actorId);
    if (actor === undefined) {
      throw new SocialError('GUILD_NOT_IN_GUILD');
    }
    if (actor.role !== 'leader') {
      throw new SocialError('GUILD_NOT_LEADER');
    }
    const target = await findCharacterById(this.database, targetId);
    if (target === undefined || target.realmId !== actor.guild.realmId) {
      throw new SocialError('GUILD_TARGET_UNAVAILABLE');
    }
    if ((await findGuildMembership(this.database, targetId)) !== undefined) {
      throw new SocialError('GUILD_TARGET_IN_GUILD');
    }
    if ((await countGuildMembers(this.database, actor.guild.id)) >= this.memberLimit) {
      throw new SocialError('GUILD_FULL');
    }
    return {
      guildId: actor.guild.id,
      guildName: actor.guild.name,
      realmId: actor.guild.realmId,
      targetName: target.name,
    };
  }

  /** Joins an invited player; the invite itself was validated by the room. */
  async join(guildId: string, characterId: string): Promise<GuildRecord> {
    const record = await this.database.transaction(async (tx) => {
      const guild = await lockGuildById(tx, guildId);
      if (guild === undefined) {
        throw new SocialError('GUILD_NOT_FOUND');
      }
      if ((await findGuildMembership(tx, characterId)) !== undefined) {
        throw new SocialError('GUILD_ALREADY_IN_GUILD');
      }
      const character = await findCharacterById(tx, characterId);
      if (character === undefined || character.realmId !== guild.realmId) {
        throw new SocialError('GUILD_TARGET_UNAVAILABLE');
      }
      if ((await countGuildMembers(tx, guildId)) >= this.memberLimit) {
        throw new SocialError('GUILD_FULL');
      }
      try {
        await insertGuildMember(tx, {
          guildId,
          characterId,
          role: 'member',
          joinedAt: this.now(),
        });
      } catch (error) {
        // Another guild won the one-membership-per-character race.
        if (isUniqueViolation(error)) {
          throw new SocialError('GUILD_ALREADY_IN_GUILD');
        }
        throw error;
      }
      // Joining one guild withdraws every pending application elsewhere.
      await deleteGuildApplicationsForCharacter(tx, characterId);
      return this.viewOf(guild, tx);
    });
    if (record === null) {
      throw new SocialError('SERVICE_UNAVAILABLE');
    }
    return record;
  }

  /** Public realm directory; applications are only marked, not listed. */
  async directory(characterId: string): Promise<GuildDirectoryRecord> {
    const character = await findCharacterById(this.database, characterId);
    if (character === undefined) {
      throw new SocialError('INVALID_SESSION');
    }
    const [summaries, appliedGuildIds] = await Promise.all([
      listGuildSummaries(this.database, character.realmId, GUILD_DIRECTORY_MAX),
      listGuildApplicationGuildIds(this.database, characterId),
    ]);
    const applied = new Set(appliedGuildIds);
    return {
      guilds: summaries.map((summary) => ({
        guildId: summary.guildId,
        name: summary.name,
        leaderName: summary.leaderName ?? '未知',
        memberCount: summary.memberCount,
        memberLimit: this.memberLimit,
        applied: applied.has(summary.guildId),
      })),
    };
  }

  /**
   * A guildless character applies to one guild. Applying to several guilds is
   * allowed; a repeated application to the same guild is idempotent.
   */
  async apply(characterId: string, guildId: string): Promise<GuildApplyOutcome> {
    const character = await findCharacterById(this.database, characterId);
    if (character === undefined) {
      throw new SocialError('INVALID_SESSION');
    }
    if ((await findGuildMembership(this.database, characterId)) !== undefined) {
      throw new SocialError('GUILD_ALREADY_IN_GUILD');
    }
    const guild = await findGuildById(this.database, guildId);
    if (guild === undefined || guild.realmId !== character.realmId) {
      throw new SocialError('GUILD_NOT_FOUND');
    }
    if ((await countGuildMembers(this.database, guildId)) >= this.memberLimit) {
      throw new SocialError('GUILD_FULL');
    }
    const leader = await findGuildLeader(this.database, guildId);
    if (leader === undefined) {
      throw new SocialError('GUILD_NOT_FOUND');
    }
    const existing = await findGuildApplication(this.database, guildId, characterId);
    if (existing === undefined) {
      await insertGuildApplication(this.database, {
        guildId,
        characterId,
        createdAt: this.now(),
      });
    }
    return {
      guildId,
      guildName: guild.name,
      leaderId: leader.characterId,
      characterName: character.name,
    };
  }

  /** Leader-only application list; empty for members and guildless players. */
  async applications(characterId: string): Promise<GuildApplicationRecord[]> {
    const membership = await findGuildMembership(this.database, characterId);
    if (membership === undefined || membership.role !== 'leader') {
      return [];
    }
    const rows = await listGuildApplications(
      this.database,
      membership.guild.id,
      GUILD_APPLICATION_LIST_MAX,
    );
    return rows.map((row) => ({
      applicationId: row.applicationId,
      playerId: row.characterId,
      displayName: row.name,
      classId: row.classId as CharacterClass,
      level: row.level,
      createdAt: row.createdAt.getTime(),
    }));
  }

  /** Accepts a pending application; capacity and one-guild-per-character hold. */
  async acceptApplication(
    actorId: string,
    applicationId: string,
  ): Promise<GuildApplicationAcceptOutcome> {
    const result = await this.database.transaction(
      async (
        tx,
      ): Promise<
        { kind: 'joined'; outcome: GuildApplicationAcceptOutcome } | { kind: 'already' }
      > => {
        const actor = await findGuildMembership(tx, actorId);
        if (actor === undefined) {
          throw new SocialError('GUILD_NOT_IN_GUILD');
        }
        if (actor.role !== 'leader') {
          throw new SocialError('GUILD_NOT_LEADER');
        }
        await lockGuildById(tx, actor.guild.id);
        const application = await findGuildApplicationById(tx, applicationId);
        if (application === undefined || application.guildId !== actor.guild.id) {
          throw new SocialError('GUILD_APPLICATION_NOT_FOUND');
        }
        const applicant = await findCharacterById(tx, application.characterId);
        if (applicant === undefined || applicant.realmId !== actor.guild.realmId) {
          throw new SocialError('GUILD_APPLICATION_NOT_FOUND');
        }
        if ((await findGuildMembership(tx, applicant.id)) !== undefined) {
          // The applicant joined elsewhere while the request was pending; drop
          // the stale row, then report the rejection after the commit.
          await deleteGuildApplication(tx, application.id);
          return { kind: 'already' };
        }
        if ((await countGuildMembers(tx, actor.guild.id)) >= this.memberLimit) {
          throw new SocialError('GUILD_FULL');
        }
        try {
          await insertGuildMember(tx, {
            guildId: actor.guild.id,
            characterId: applicant.id,
            role: 'member',
            joinedAt: this.now(),
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new SocialError('GUILD_ALREADY_IN_GUILD');
          }
          throw error;
        }
        await deleteGuildApplicationsForCharacter(tx, applicant.id);
        const remaining = await listGuildMemberIds(tx, actor.guild.id);
        return {
          kind: 'joined',
          outcome: {
            guildId: actor.guild.id,
            guildName: actor.guild.name,
            memberIds: remaining,
            applicantId: applicant.id,
            applicantName: applicant.name,
          },
        };
      },
    );
    if (result.kind === 'already') {
      throw new SocialError('GUILD_ALREADY_IN_GUILD');
    }
    return result.outcome;
  }

  async declineApplication(
    actorId: string,
    applicationId: string,
  ): Promise<GuildApplicationDeclineOutcome> {
    return this.database.transaction(async (tx) => {
      const actor = await findGuildMembership(tx, actorId);
      if (actor === undefined) {
        throw new SocialError('GUILD_NOT_IN_GUILD');
      }
      if (actor.role !== 'leader') {
        throw new SocialError('GUILD_NOT_LEADER');
      }
      const application = await findGuildApplicationById(tx, applicationId);
      if (application === undefined || application.guildId !== actor.guild.id) {
        throw new SocialError('GUILD_APPLICATION_NOT_FOUND');
      }
      const applicant = await findCharacterById(tx, application.characterId);
      await deleteGuildApplication(tx, application.id);
      return {
        guildId: actor.guild.id,
        guildName: actor.guild.name,
        applicantId: application.characterId,
        applicantName: applicant?.name ?? '玩家',
      };
    });
  }

  /**
   * Leaving as the leader hands leadership to the earliest remaining member;
   * the last member out removes the guild so no leaderless guild can linger.
   */
  async leave(characterId: string): Promise<GuildLeaveOutcome> {
    return this.database.transaction(async (tx) => {
      const membership = await findGuildMembership(tx, characterId);
      if (membership === undefined) {
        throw new SocialError('GUILD_NOT_IN_GUILD');
      }
      await lockGuildById(tx, membership.guild.id);
      if (membership.role === 'leader') {
        const heirId = await findOldestGuildMemberId(tx, membership.guild.id, characterId);
        const remaining = (await listGuildMemberIds(tx, membership.guild.id)).filter(
          (id) => id !== characterId,
        );
        if (heirId === undefined) {
          await deleteGuildById(tx, membership.guild.id);
          return {
            guildId: membership.guild.id,
            memberIds: [characterId],
            disbanded: true,
            newLeaderId: null,
          };
        }
        // The partial unique index allows at most one leader, so the old row
        // must go before the heir is promoted.
        await deleteGuildMember(tx, membership.guild.id, characterId);
        await updateGuildMemberRole(tx, membership.guild.id, heirId, 'leader');
        return {
          guildId: membership.guild.id,
          memberIds: [characterId, ...remaining],
          disbanded: false,
          newLeaderId: heirId,
        };
      }
      await deleteGuildMember(tx, membership.guild.id, characterId);
      const remaining = (await listGuildMemberIds(tx, membership.guild.id)).filter(
        (id) => id !== characterId,
      );
      return {
        guildId: membership.guild.id,
        memberIds: [characterId, ...remaining],
        disbanded: false,
        newLeaderId: null,
      };
    });
  }

  async kick(actorId: string, targetId: string): Promise<GuildKickOutcome> {
    if (actorId === targetId) {
      throw new SocialError('GUILD_TARGET_SELF');
    }
    return this.database.transaction(async (tx) => {
      const actor = await findGuildMembership(tx, actorId);
      if (actor === undefined) {
        throw new SocialError('GUILD_NOT_IN_GUILD');
      }
      if (actor.role !== 'leader') {
        throw new SocialError('GUILD_NOT_LEADER');
      }
      await lockGuildById(tx, actor.guild.id);
      const target = await findGuildMembership(tx, targetId);
      if (target === undefined || target.guild.id !== actor.guild.id) {
        throw new SocialError('GUILD_TARGET_NOT_MEMBER');
      }
      await deleteGuildMember(tx, actor.guild.id, targetId);
      const remaining = (await listGuildMemberIds(tx, actor.guild.id)).filter(
        (id) => id !== targetId,
      );
      return {
        guildId: actor.guild.id,
        memberIds: [targetId, ...remaining],
        kickedId: targetId,
      };
    });
  }

  async disband(actorId: string): Promise<GuildDisbandOutcome> {
    return this.database.transaction(async (tx) => {
      const actor = await findGuildMembership(tx, actorId);
      if (actor === undefined) {
        throw new SocialError('GUILD_NOT_IN_GUILD');
      }
      if (actor.role !== 'leader') {
        throw new SocialError('GUILD_NOT_LEADER');
      }
      await lockGuildById(tx, actor.guild.id);
      const memberIds = await listGuildMemberIds(tx, actor.guild.id);
      await deleteGuildById(tx, actor.guild.id);
      return { guildId: actor.guild.id, memberIds };
    });
  }

  /** Online guildmates of a character, excluding the character itself. */
  async guildmateIds(characterId: string): Promise<string[]> {
    const membership = await findGuildMembership(this.database, characterId);
    if (membership === undefined) {
      return [];
    }
    const ids = await listGuildMemberIds(this.database, membership.guild.id);
    return ids.filter((id) => id !== characterId);
  }

  /** Every member of the sender's guild, or null when the sender has none. */
  async chatRecipients(characterId: string): Promise<string[] | null> {
    const membership = await findGuildMembership(this.database, characterId);
    if (membership === undefined) {
      return null;
    }
    return listGuildMemberIds(this.database, membership.guild.id);
  }

  private async viewOf(
    guild: Guild,
    executor: DbExecutor = this.database,
  ): Promise<GuildRecord | null> {
    const members = await listGuildMembers(executor, guild.id);
    if (members.length === 0) {
      return null;
    }
    return toRecord(guild, members, this.memberLimit);
  }
}

function toRecord(guild: Guild, members: GuildMemberProfile[], memberLimit: number): GuildRecord {
  const leader = members.find((member) => member.role === 'leader') ?? members[0];
  return {
    guildId: guild.id,
    name: guild.name,
    leaderId: leader?.characterId ?? '',
    memberLimit,
    members: members.map((member) => ({
      playerId: member.characterId,
      displayName: member.name,
      classId: member.classId as CharacterClass,
      level: member.level,
      leader: member.role === 'leader',
      joinedAt: member.joinedAt.getTime(),
    })),
  };
}
