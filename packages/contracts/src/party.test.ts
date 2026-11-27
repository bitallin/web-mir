import { describe, expect, it } from 'vitest';

import {
  PARTY_MAX_MEMBERS,
  partyAcceptCommandSchema,
  partyInviteCommandSchema,
  partyInviteViewSchema,
  partyKickCommandSchema,
  partyLeaveCommandSchema,
  partySnapshotSchema,
  partyTransferLeaderCommandSchema,
  partyViewSchema,
} from './party';

const PLAYER = '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d01';
const OTHER = '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d02';
const PARTY = '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d03';
const INVITE = '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d04';
const COMMAND = '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d05';

function member(playerId: string, leader: boolean) {
  return {
    playerId,
    displayName: 'Guardian',
    classId: 'warrior' as const,
    level: 3,
    hp: 100,
    maxHp: 120,
    alive: true,
    connected: true,
    leader,
  };
}

describe('party contracts', () => {
  it('accepts a roster with a leader and current vitals', () => {
    const view = partyViewSchema.parse({
      partyId: PARTY,
      leaderId: PLAYER,
      maxMembers: 4,
      members: [member(PLAYER, true), member(OTHER, false)],
    });
    expect(view.members).toHaveLength(2);
    expect(view.maxMembers).toBeLessThanOrEqual(PARTY_MAX_MEMBERS);
  });

  it('rejects a roster beyond the wire limit and unknown fields', () => {
    const members = Array.from({ length: PARTY_MAX_MEMBERS + 1 }, (_value, index) =>
      member(index === 0 ? PLAYER : OTHER, index === 0),
    );
    expect(
      partyViewSchema.safeParse({
        partyId: PARTY,
        leaderId: PLAYER,
        maxMembers: 4,
        members,
      }).success,
    ).toBe(false);
    expect(partySnapshotSchema.safeParse({ party: null, serverTime: 1, extra: true }).success).toBe(
      false,
    );
  });

  it('allows an empty party snapshot before the player joins a party', () => {
    expect(partySnapshotSchema.parse({ party: null, serverTime: 12 })).toEqual({
      party: null,
      serverTime: 12,
    });
  });

  it('validates invite prompts with an expiry', () => {
    const invite = partyInviteViewSchema.parse({
      inviteId: INVITE,
      fromPlayerId: PLAYER,
      fromDisplayName: 'Guardian',
      expiresAt: 1_000,
      serverTime: 900,
    });
    expect(invite.expiresAt).toBe(1_000);
    expect(
      partyInviteViewSchema.safeParse({
        inviteId: INVITE,
        fromPlayerId: PLAYER,
        fromDisplayName: 'Guardian',
        serverTime: 900,
      }).success,
    ).toBe(false);
  });

  it('requires command metadata and rejects client-supplied party state', () => {
    const base = { protocolVersion: 1, commandId: COMMAND, clientSequence: 4 };
    expect(partyInviteCommandSchema.parse({ ...base, targetPlayerId: OTHER })).toMatchObject({
      targetPlayerId: OTHER,
    });
    expect(
      partyInviteCommandSchema.safeParse({ ...base, targetPlayerId: OTHER, partyId: PARTY })
        .success,
    ).toBe(false);
    expect(partyAcceptCommandSchema.safeParse({ ...base, targetPlayerId: OTHER }).success).toBe(
      false,
    );
    expect(partyLeaveCommandSchema.parse(base)).toEqual(base);
  });

  it('accepts leader-only transfer and kick commands with a target member', () => {
    const base = { protocolVersion: 1, commandId: COMMAND, clientSequence: 5 };
    expect(
      partyTransferLeaderCommandSchema.parse({ ...base, targetPlayerId: OTHER }),
    ).toMatchObject({ targetPlayerId: OTHER });
    expect(partyKickCommandSchema.parse({ ...base, targetPlayerId: OTHER })).toMatchObject({
      targetPlayerId: OTHER,
    });
    expect(partyKickCommandSchema.safeParse({ ...base, targetPlayerId: 'nobody' }).success).toBe(
      false,
    );
    expect(
      partyTransferLeaderCommandSchema.safeParse({
        ...base,
        targetPlayerId: OTHER,
        leaderId: PLAYER,
      }).success,
    ).toBe(false);
  });
});
