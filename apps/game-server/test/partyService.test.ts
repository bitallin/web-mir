import { describe, expect, it } from 'vitest';

import type { PartyInviteView } from '@web-legend/contracts';

import { PartyService } from '../src/world/partyService';

function presence(playerId: string, roomId: string | null, connected = true) {
  return {
    playerId,
    displayName: `Player-${playerId}`,
    classId: 'warrior' as const,
    level: 3,
    hp: 100,
    maxHp: 120,
    alive: true,
    connected,
    roomId,
  };
}

function serviceWithRooms() {
  const service = new PartyService({ inviteTtlMs: 30_000 });
  const invites: { roomId: string; playerId: string; invite: PartyInviteView }[] = [];
  const refreshes: { roomId: string; playerIds: readonly string[] }[] = [];
  for (const roomId of ['room-a', 'room-b']) {
    service.registerRoom(roomId, {
      sendInvite: (playerId, invite) => {
        invites.push({ roomId, playerId, invite });
      },
      refresh: (playerIds) => {
        refreshes.push({ roomId, playerIds: [...playerIds] });
      },
    });
  }
  return { service, invites, refreshes };
}

describe('PartyService', () => {
  it('routes an invitation to the room hosting the invited player', () => {
    const { service, invites } = serviceWithRooms();
    service.setPresence(presence('a', 'room-a'));
    service.setPresence(presence('b', 'room-b'));

    const result = service.createInvite('a', 'b');
    expect(result.kind).toBe('invited');
    if (result.kind !== 'invited') {
      return;
    }
    service.notifyInvite(result.invite);

    expect(invites).toHaveLength(1);
    expect(invites[0]?.roomId).toBe('room-b');
    expect(invites[0]?.invite.fromDisplayName).toBe('Player-a');
  });

  it('refreshes both rooms when an invite is accepted', () => {
    const { service, refreshes } = serviceWithRooms();
    service.setPresence(presence('a', 'room-a'));
    service.setPresence(presence('b', 'room-b'));
    const invite = service.createInvite('a', 'b');
    if (invite.kind !== 'invited') {
      throw new Error('invite rejected');
    }

    expect(service.acceptInvite(invite.invite.inviteId, 'b').kind).toBe('joined');
    expect(service.partyOf('a')?.memberIds).toEqual(['a', 'b']);
    expect(refreshes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roomId: 'room-a' }),
        expect.objectContaining({ roomId: 'room-b' }),
      ]),
    );
  });

  it('keeps membership when a member is between rooms and restores presence on join', () => {
    const { service, refreshes } = serviceWithRooms();
    service.setPresence(presence('a', 'room-a'));
    service.setPresence(presence('b', 'room-b'));
    const invite = service.createInvite('a', 'b');
    if (invite.kind !== 'invited') {
      throw new Error('invite rejected');
    }
    service.acceptInvite(invite.invite.inviteId, 'b');
    refreshes.length = 0;

    service.markOffline('b');
    expect(service.partyOf('b')).toBeDefined();
    expect(service.presenceOf('b')).toMatchObject({ connected: false, roomId: null });
    service.refreshMembers(['a', 'b']);

    // Only the room that still hosts a member is refreshed; the teleporting
    // member gets their snapshot from the destination room on join.
    expect(refreshes).toEqual([{ roomId: 'room-a', playerIds: ['a'] }]);

    service.setPresence(presence('b', 'room-c'));
    expect(service.presenceOf('b')).toMatchObject({ connected: true, roomId: 'room-c' });
    expect(service.partyOf('a')?.memberIds).toEqual(['a', 'b']);
  });

  it('removes the party member and presence only when the world session ends', () => {
    const { service } = serviceWithRooms();
    service.setPresence(presence('a', 'room-a'));
    service.setPresence(presence('b', 'room-b'));
    const invite = service.createInvite('a', 'b');
    if (invite.kind !== 'invited') {
      throw new Error('invite rejected');
    }
    service.acceptInvite(invite.invite.inviteId, 'b');

    // Leaving the party keeps world presence for future invites.
    service.leave('b');
    expect(service.presenceOf('b')).toBeDefined();
    expect(service.partyOf('a')?.memberIds).toEqual(['a']);

    // Leaving the world drops both.
    service.removePlayer('a');
    expect(service.presenceOf('a')).toBeUndefined();
    expect(service.partyOf('a')).toBeUndefined();
  });
});
