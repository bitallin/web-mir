import { describe, expect, it } from 'vitest';

import type { PartyInviteView } from '@web-legend/contracts';

import { PlayerDirectory } from '../src/world/playerDirectory';
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

function serviceWithRooms(now?: () => number) {
  const directory = new PlayerDirectory();
  const service = new PartyService({
    directory,
    inviteTtlMs: 30_000,
    ...(now === undefined ? {} : { now }),
  });
  const invites: { roomId: string; playerId: string; invite: PartyInviteView }[] = [];
  const refreshes: { roomId: string; playerIds: readonly string[] }[] = [];
  const chats: { roomId: string; playerId: string; channel: string }[] = [];
  for (const roomId of ['room-a', 'room-b']) {
    directory.registerRoom(roomId, {
      deliver: (playerId, delivery) => {
        if (delivery.kind === 'party.invite') {
          invites.push({ roomId, playerId, invite: delivery.invite });
        } else if (delivery.kind === 'chat') {
          chats.push({ roomId, playerId, channel: delivery.message.channel });
        } else if (delivery.kind === 'party.refresh') {
          refreshes.push({ roomId, playerIds: [playerId] });
        }
      },
    });
  }
  return { service, directory, invites, refreshes, chats };
}

describe('PartyService', () => {
  it('routes an invitation to the room hosting the invited player', () => {
    const { service, directory, invites } = serviceWithRooms();
    directory.setPresence(presence('a', 'room-a'));
    directory.setPresence(presence('b', 'room-b'));

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
    const { service, directory, refreshes } = serviceWithRooms();
    directory.setPresence(presence('a', 'room-a'));
    directory.setPresence(presence('b', 'room-b'));
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
    const { service, directory, refreshes } = serviceWithRooms();
    directory.setPresence(presence('a', 'room-a'));
    directory.setPresence(presence('b', 'room-b'));
    const invite = service.createInvite('a', 'b');
    if (invite.kind !== 'invited') {
      throw new Error('invite rejected');
    }
    service.acceptInvite(invite.invite.inviteId, 'b');
    refreshes.length = 0;

    directory.markOffline('b');
    expect(service.partyOf('b')).toBeDefined();
    expect(directory.presenceOf('b')).toMatchObject({ connected: false, roomId: null });
    service.refreshMembers(['a', 'b']);

    // Only the room that still hosts a member is refreshed; the teleporting
    // member gets their snapshot from the destination room on join.
    expect(refreshes).toEqual([{ roomId: 'room-a', playerIds: ['a'] }]);

    directory.setPresence(presence('b', 'room-c'));
    expect(directory.presenceOf('b')).toMatchObject({ connected: true, roomId: 'room-c' });
    expect(service.partyOf('a')?.memberIds).toEqual(['a', 'b']);
  });

  it('removes the party member and presence only when the world session ends', () => {
    const { service, directory } = serviceWithRooms();
    directory.setPresence(presence('a', 'room-a'));
    directory.setPresence(presence('b', 'room-b'));
    const invite = service.createInvite('a', 'b');
    if (invite.kind !== 'invited') {
      throw new Error('invite rejected');
    }
    service.acceptInvite(invite.invite.inviteId, 'b');

    // Leaving the party keeps world presence for future invites.
    service.leave('b');
    expect(directory.presenceOf('b')).toBeDefined();
    expect(service.partyOf('a')?.memberIds).toEqual(['a']);

    // Leaving the world drops the party and the directory entry; the room owns
    // both calls so presence cleanup is not a party side effect.
    service.leave('a');
    directory.removePlayer('a');
    expect(directory.presenceOf('a')).toBeUndefined();
    expect(service.partyOf('a')).toBeUndefined();
  });
});

describe('PartyService management and chat', () => {
  function twoMemberParty() {
    const rooms = serviceWithRooms();
    for (const playerId of ['a', 'b']) {
      rooms.directory.setPresence(presence(playerId, playerId === 'a' ? 'room-a' : 'room-b'));
    }
    const invite = rooms.service.createInvite('a', 'b');
    if (invite.kind !== 'invited') {
      throw new Error('invite rejected');
    }
    rooms.service.acceptInvite(invite.invite.inviteId, 'b');
    rooms.refreshes.length = 0;
    return rooms;
  }

  it('refreshes both rooms after a leadership hand-over', () => {
    const { service, refreshes } = twoMemberParty();
    expect(service.transferLeader('a', 'b').kind).toBe('transferred');
    expect(refreshes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roomId: 'room-a' }),
        expect.objectContaining({ roomId: 'room-b' }),
      ]),
    );
    expect(service.partyOf('a')?.leaderId).toBe('b');
  });

  it('refreshes the kicked player’s room so their roster clears', () => {
    const { service, directory, refreshes } = twoMemberParty();
    expect(service.kick('a', 'b').kind).toBe('kicked');
    // The kicked player is routed by presence even though they are no longer
    // a member; the room turns their snapshot into a null party.
    expect(refreshes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roomId: 'room-a', playerIds: ['a'] }),
        expect.objectContaining({ roomId: 'room-b', playerIds: ['b'] }),
      ]),
    );
    expect(service.partyOf('b')).toBeUndefined();
    expect(directory.presenceOf('b')).toBeDefined();
  });

  it('remembers a former teammate only once the party actually formed', () => {
    const { service } = twoMemberParty();
    expect(service.knowsTeammate('a', 'b')).toBe(true);
    expect(service.knowsTeammate('b', 'a')).toBe(true);
    expect(service.recentPartners('a').map((record) => record.playerId)).toEqual(['b']);
    const record = service.recentPartners('b')[0];
    expect(record?.playerId).toBe('a');
    expect(record?.displayName).toBe('Player-a');
    expect(typeof record?.lastPlayedAt).toBe('number');

    // An unanswered invite is not a shared party and must not grant reach.
    const untouched = serviceWithRooms();
    untouched.directory.setPresence(presence('c', 'room-a'));
    untouched.directory.setPresence(presence('d', 'room-b'));
    untouched.service.createInvite('c', 'd');
    expect(untouched.service.knowsTeammate('c', 'd')).toBe(false);
  });

  it('keeps only the newest teammates per player', () => {
    let clock = 1_000;
    const { service, directory } = serviceWithRooms(() => clock);
    directory.setPresence(presence('a', 'room-a'));
    for (let index = 0; index < 25; index += 1) {
      const teammateId = `teammate-${String(index)}`;
      directory.setPresence(presence(teammateId, 'room-b'));
      const invite = service.createInvite('a', teammateId);
      if (invite.kind !== 'invited') {
        throw new Error('invite rejected');
      }
      clock += 1_000;
      expect(service.acceptInvite(invite.invite.inviteId, teammateId).kind).toBe('joined');
      service.leave(teammateId);
    }

    const recent = service.recentPartners('a');
    expect(recent).toHaveLength(20);
    expect(recent.map((record) => record.playerId)).not.toContain('teammate-0');
    expect(recent[0]?.playerId).toBe('teammate-24');
  });

  it('delivers party chat to each member through the room that hosts them', () => {
    const { service, chats } = twoMemberParty();
    service.deliverChat(['a', 'b'], {
      messageId: '0192f0a0-0000-7000-8000-000000000010',
      playerId: 'a',
      displayName: 'Player-a',
      message: 'regroup',
      channel: 'party',
      serverTime: 10,
    });
    expect(chats).toEqual(
      expect.arrayContaining([
        { roomId: 'room-a', playerId: 'a', channel: 'party' },
        { roomId: 'room-b', playerId: 'b', channel: 'party' },
      ]),
    );
  });

  it('drops chat for a member who is between rooms', () => {
    const { service, directory, chats } = twoMemberParty();
    directory.markOffline('b');
    service.deliverChat(['a', 'b'], {
      messageId: '0192f0a0-0000-7000-8000-000000000011',
      playerId: 'a',
      displayName: 'Player-a',
      message: 'regroup',
      channel: 'party',
      serverTime: 10,
    });
    expect(chats).toEqual([{ roomId: 'room-a', playerId: 'a', channel: 'party' }]);
  });
});
