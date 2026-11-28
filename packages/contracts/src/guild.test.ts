import { describe, expect, it } from 'vitest';

import {
  GUILD_MEMBER_LIMIT,
  guildAcceptCommandSchema,
  guildCreateCommandSchema,
  guildInviteCommandSchema,
  guildInviteViewSchema,
  guildKickCommandSchema,
  guildMemberViewSchema,
  guildNameSchema,
  guildPresenceSchema,
  guildSnapshotSchema,
  guildViewSchema,
  normalizeGuildName,
} from './guild';

const GUILD = '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d01';
const PLAYER = '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d02';
const OTHER = '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d03';
const COMMAND = '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d04';
const INVITE = '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d05';

const member = {
  playerId: PLAYER,
  displayName: 'Guardian',
  classId: 'warrior' as const,
  level: 5,
  online: true,
  alive: true,
  leader: true,
  joinedAt: 1_000,
};

const commandBase = {
  protocolVersion: 1,
  commandId: COMMAND,
  clientSequence: 0,
};

describe('guild contracts', () => {
  it('normalizes guild names like character names', () => {
    expect(guildNameSchema.parse('  黎明  ')).toBe('黎明');
    expect(guildNameSchema.parse('ＡＢＣ')).toBe('ABC');
    expect(normalizeGuildName(' ＡＢＣ ')).toBe('abc');
    expect(guildNameSchema.safeParse('a').success).toBe(false);
    expect(guildNameSchema.safeParse('bad name').success).toBe(false);
    expect(guildNameSchema.safeParse('名'.repeat(13)).success).toBe(false);
  });

  it('carries a guild roster in a private snapshot', () => {
    const guild = guildViewSchema.parse({
      guildId: GUILD,
      name: '黎明',
      leaderId: PLAYER,
      memberLimit: GUILD_MEMBER_LIMIT,
      members: [member],
    });
    expect(guild.members[0]?.leader).toBe(true);

    const snapshot = guildSnapshotSchema.parse({ guild, serverTime: 2_000 });
    expect(snapshot.guild?.name).toBe('黎明');
    expect(guildSnapshotSchema.parse({ guild: null, serverTime: 3_000 }).guild).toBeNull();
  });

  it('rejects a roster larger than the member limit', () => {
    const members = Array.from({ length: GUILD_MEMBER_LIMIT + 1 }, (_value, index) => ({
      ...member,
      playerId: `018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d${String(index).padStart(2, '0')}`,
    }));
    expect(
      guildViewSchema.safeParse({
        guildId: GUILD,
        name: '黎明',
        leaderId: PLAYER,
        memberLimit: GUILD_MEMBER_LIMIT,
        members,
      }).success,
    ).toBe(false);
  });

  it('parses create, invite and kick commands', () => {
    const create = guildCreateCommandSchema.parse({ ...commandBase, name: ' 黎明 ' });
    expect(create.name).toBe('黎明');
    expect(
      guildInviteCommandSchema.safeParse({ ...commandBase, targetPlayerId: OTHER }).success,
    ).toBe(true);
    expect(
      guildKickCommandSchema.safeParse({ ...commandBase, targetPlayerId: OTHER }).success,
    ).toBe(true);
    expect(guildAcceptCommandSchema.safeParse({ ...commandBase, inviteId: INVITE }).success).toBe(
      true,
    );
    expect(
      guildInviteCommandSchema.safeParse({ ...commandBase, targetPlayerId: 'nope' }).success,
    ).toBe(false);
  });

  it('carries an invite and a guildmate presence transition', () => {
    const invite = guildInviteViewSchema.parse({
      inviteId: INVITE,
      guildId: GUILD,
      guildName: '黎明',
      fromPlayerId: PLAYER,
      fromDisplayName: 'Guardian',
      expiresAt: 5_000,
      serverTime: 1_000,
    });
    expect(invite.guildName).toBe('黎明');

    expect(
      guildPresenceSchema.safeParse({
        playerId: OTHER,
        online: true,
        level: 6,
        classId: 'mage',
        alive: true,
        serverTime: 2_000,
      }).success,
    ).toBe(true);
    expect(guildMemberViewSchema.safeParse({ ...member, leader: false }).success).toBe(true);
  });
});
