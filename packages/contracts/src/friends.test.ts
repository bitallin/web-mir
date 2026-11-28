import { describe, expect, it } from 'vitest';

import {
  FRIEND_LIST_MAX,
  RECENT_TEAMMATES_MAX,
  friendAcceptCommandSchema,
  friendEntrySchema,
  friendListCommandSchema,
  friendPresenceSchema,
  friendRefreshSchema,
  friendRemoveCommandSchema,
  friendRequestCommandSchema,
  friendRequestViewSchema,
  friendSnapshotSchema,
  recentTeammateViewSchema,
} from './friends';

const PLAYER = '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d01';
const OTHER = '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d02';
const REQUEST = '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d03';
const COMMAND = '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d04';

const friend = {
  playerId: OTHER,
  displayName: 'Guardian',
  classId: 'warrior' as const,
  level: 5,
  online: true,
  alive: true,
};

const request = {
  requestId: REQUEST,
  playerId: OTHER,
  displayName: 'Guardian',
  classId: 'warrior' as const,
  level: 5,
  outgoing: false,
  createdAt: 1_000,
};

describe('friend contracts', () => {
  it('accepts a snapshot with friends and both request directions', () => {
    const snapshot = friendSnapshotSchema.parse({
      friends: [friend],
      incoming: [request],
      outgoing: [{ ...request, outgoing: true }],
      serverTime: 2_000,
    });
    expect(snapshot.friends).toHaveLength(1);
    expect(snapshot.incoming[0]?.outgoing).toBe(false);
    expect(snapshot.outgoing[0]?.outgoing).toBe(true);
    expect(snapshot.recent).toEqual([]);
  });

  it('carries former teammates and caps the list', () => {
    const teammate = {
      playerId: OTHER,
      displayName: 'Former',
      classId: 'taoist' as const,
      level: 7,
      online: true,
      lastPlayedAt: 5_000,
    };
    expect(recentTeammateViewSchema.safeParse(teammate).success).toBe(true);
    const snapshot = friendSnapshotSchema.parse({
      friends: [],
      incoming: [],
      outgoing: [],
      recent: [teammate],
      serverTime: 6_000,
    });
    expect(snapshot.recent[0]?.displayName).toBe('Former');

    const tooMany = Array.from({ length: RECENT_TEAMMATES_MAX + 1 }, (_value, index) => ({
      ...teammate,
      playerId: `018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d${String(index).padStart(2, '0')}`,
    }));
    expect(
      friendSnapshotSchema.safeParse({
        friends: [],
        incoming: [],
        outgoing: [],
        recent: tooMany,
        serverTime: 1,
      }).success,
    ).toBe(false);
  });

  it('rejects oversized rosters and unknown fields', () => {
    const friends = Array.from({ length: FRIEND_LIST_MAX + 1 }, (_value, index) => ({
      ...friend,
      playerId: index === 0 ? PLAYER : OTHER,
    }));
    expect(
      friendSnapshotSchema.safeParse({
        friends,
        incoming: [],
        outgoing: [],
        serverTime: 1,
      }).success,
    ).toBe(false);
    expect(friendEntrySchema.safeParse({ ...friend, extra: true }).success).toBe(false);
  });

  it('validates presence updates and refreshes', () => {
    expect(
      friendPresenceSchema.parse({ playerId: OTHER, online: true, level: 5, serverTime: 9 }),
    ).toMatchObject({ online: true, level: 5 });
    expect(friendPresenceSchema.parse({ playerId: OTHER, online: false, serverTime: 9 })).toEqual({
      playerId: OTHER,
      online: false,
      serverTime: 9,
    });
    expect(friendRefreshSchema.safeParse({ serverTime: 9 }).success).toBe(true);
    expect(friendRefreshSchema.safeParse({ extra: true }).success).toBe(false);
  });

  it('accepts friend commands and rejects client-supplied relationship state', () => {
    const base = { protocolVersion: 1, commandId: COMMAND, clientSequence: 3 };
    expect(friendRequestCommandSchema.parse({ ...base, targetPlayerId: OTHER })).toMatchObject({
      targetPlayerId: OTHER,
    });
    expect(friendAcceptCommandSchema.parse({ ...base, requestId: REQUEST })).toMatchObject({
      requestId: REQUEST,
    });
    expect(friendRemoveCommandSchema.parse({ ...base, friendPlayerId: OTHER })).toMatchObject({
      friendPlayerId: OTHER,
    });
    expect(friendListCommandSchema.parse(base)).toEqual(base);
    expect(
      friendRequestCommandSchema.safeParse({ ...base, targetPlayerId: OTHER, status: 'accepted' })
        .success,
    ).toBe(false);
  });

  it('requires the request view to say which direction it came from', () => {
    const withoutDirection = {
      requestId: REQUEST,
      playerId: OTHER,
      displayName: 'Guardian',
      classId: 'warrior',
      level: 5,
      createdAt: 1_000,
    };
    expect(friendRequestViewSchema.safeParse(withoutDirection).success).toBe(false);
  });
});
