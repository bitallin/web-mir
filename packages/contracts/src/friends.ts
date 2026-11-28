import { z } from 'zod';

import { characterClassSchema } from './character';

/**
 * Friends are persistent character relations (ADR-045). Online status is not
 * stored with the relation: the server merges the process-wide presence into
 * each snapshot, so a stale row never claims a player is online.
 */

/** Wire bounds keep a hostile client from requesting an unbounded roster. */
export const FRIEND_LIST_MAX = 200 as const;
export const FRIEND_REQUEST_LIST_MAX = 100 as const;
/** Former party members kept per player; enough to re-invite, too few to farm. */
export const RECENT_TEAMMATES_MAX = 20 as const;

export const friendEntrySchema = z
  .object({
    playerId: z.uuid(),
    displayName: z.string().min(1).max(32),
    classId: characterClassSchema,
    level: z.number().int().min(1).max(100),
    online: z.boolean(),
    alive: z.boolean(),
  })
  .strict();

export type FriendEntry = z.infer<typeof friendEntrySchema>;

export const friendRequestViewSchema = z
  .object({
    requestId: z.uuid(),
    playerId: z.uuid(),
    displayName: z.string().min(1).max(32),
    classId: characterClassSchema,
    level: z.number().int().min(1).max(100),
    /** True when the local player sent the request. */
    outgoing: z.boolean(),
    createdAt: z.number().nonnegative(),
  })
  .strict();

export type FriendRequestView = z.infer<typeof friendRequestViewSchema>;

/**
 * Someone the player has actually shared a party with (ADR-047). The list is
 * per player and never searchable globally, so it cannot be used to find
 * strangers; it only restores a relationship the player already had.
 */
export const recentTeammateViewSchema = z
  .object({
    playerId: z.uuid(),
    displayName: z.string().min(1).max(32),
    classId: characterClassSchema,
    level: z.number().int().min(1).max(100),
    online: z.boolean(),
    /** Epoch ms of the last time both players were in the same party. */
    lastPlayedAt: z.number().nonnegative(),
  })
  .strict();

export type RecentTeammateView = z.infer<typeof recentTeammateViewSchema>;

/**
 * Sent after every relationship change and when the panel is opened. `recent`
 * defaults to empty so a snapshot produced before this field existed still
 * parses.
 */
export const friendSnapshotSchema = z
  .object({
    friends: z.array(friendEntrySchema).max(FRIEND_LIST_MAX),
    incoming: z.array(friendRequestViewSchema).max(FRIEND_REQUEST_LIST_MAX),
    outgoing: z.array(friendRequestViewSchema).max(FRIEND_REQUEST_LIST_MAX),
    recent: z.array(recentTeammateViewSchema).max(RECENT_TEAMMATES_MAX).default([]),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type FriendSnapshot = z.infer<typeof friendSnapshotSchema>;

/**
 * Online/offline transitions of one friend. Level and class are present when
 * the player came online so a stale offline row can be refreshed without a
 * full snapshot.
 */
export const friendPresenceSchema = z
  .object({
    playerId: z.uuid(),
    online: z.boolean(),
    level: z.number().int().min(1).max(100).optional(),
    classId: characterClassSchema.optional(),
    alive: z.boolean().optional(),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type FriendPresence = z.infer<typeof friendPresenceSchema>;

/** Tells a client that its friend list changed; it answers with `friend.list`. */
export const friendRefreshSchema = z
  .object({
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type FriendRefresh = z.infer<typeof friendRefreshSchema>;

const friendCommandBase = {
  protocolVersion: z.number().int().positive(),
  commandId: z.uuid(),
  clientSequence: z.number().int().min(0).max(2_147_483_647),
};

export const friendRequestCommandSchema = z
  .object({
    ...friendCommandBase,
    targetPlayerId: z.uuid(),
  })
  .strict();

export type FriendRequestCommand = z.infer<typeof friendRequestCommandSchema>;

export const friendAcceptCommandSchema = z
  .object({
    ...friendCommandBase,
    requestId: z.uuid(),
  })
  .strict();

export type FriendAcceptCommand = z.infer<typeof friendAcceptCommandSchema>;

export const friendDeclineCommandSchema = z
  .object({
    ...friendCommandBase,
    requestId: z.uuid(),
  })
  .strict();

export type FriendDeclineCommand = z.infer<typeof friendDeclineCommandSchema>;

export const friendRemoveCommandSchema = z
  .object({
    ...friendCommandBase,
    friendPlayerId: z.uuid(),
  })
  .strict();

export type FriendRemoveCommand = z.infer<typeof friendRemoveCommandSchema>;

export const friendListCommandSchema = z.object(friendCommandBase).strict();

export type FriendListCommand = z.infer<typeof friendListCommandSchema>;
