import { z } from 'zod';

import { characterClassSchema } from './character';

/**
 * Party wire contract (ADR-035). Membership is server state owned by the room
 * that hosts the players: the browser only asks to invite, accept, decline or
 * leave, and renders the roster it is given. Members never become part of the
 * public room state, so a stranger cannot read another party's roster.
 */

/** An unanswered invite dies so it can never be accepted minutes later. */
export const PARTY_INVITE_TTL_MS = 30_000;
/** Hard wire limit; content may configure a smaller party. */
export const PARTY_MAX_MEMBERS = 8;
/** An invite only reaches a player the inviter can plausibly see. */
export const PARTY_INVITE_RANGE_TILES = 15;

export const partyMemberViewSchema = z
  .object({
    playerId: z.uuid(),
    displayName: z.string().min(1).max(32),
    classId: characterClassSchema,
    level: z.number().int().min(1).max(100),
    hp: z.number().int().nonnegative(),
    maxHp: z.number().int().positive(),
    alive: z.boolean(),
    connected: z.boolean(),
    leader: z.boolean(),
  })
  .strict();

export type PartyMemberView = z.infer<typeof partyMemberViewSchema>;

export const partyViewSchema = z
  .object({
    partyId: z.uuid(),
    leaderId: z.uuid(),
    maxMembers: z.number().int().min(2).max(PARTY_MAX_MEMBERS),
    members: z.array(partyMemberViewSchema).min(1).max(PARTY_MAX_MEMBERS),
  })
  .strict();

export type PartyView = z.infer<typeof partyViewSchema>;

/** Sent privately to every member after any membership change. */
export const partySnapshotSchema = z
  .object({
    party: partyViewSchema.nullable(),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type PartySnapshot = z.infer<typeof partySnapshotSchema>;

/** Sent only to the invited player. */
export const partyInviteViewSchema = z
  .object({
    inviteId: z.uuid(),
    fromPlayerId: z.uuid(),
    fromDisplayName: z.string().min(1).max(32),
    expiresAt: z.number().nonnegative(),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type PartyInviteView = z.infer<typeof partyInviteViewSchema>;

const partyCommandBase = {
  protocolVersion: z.number().int().positive(),
  commandId: z.uuid(),
  clientSequence: z.number().int().min(0).max(2_147_483_647),
};

export const partyInviteCommandSchema = z
  .object({
    ...partyCommandBase,
    targetPlayerId: z.uuid(),
  })
  .strict();

export type PartyInviteCommand = z.infer<typeof partyInviteCommandSchema>;

export const partyAcceptCommandSchema = z
  .object({
    ...partyCommandBase,
    inviteId: z.uuid(),
  })
  .strict();

export type PartyAcceptCommand = z.infer<typeof partyAcceptCommandSchema>;

export const partyDeclineCommandSchema = z
  .object({
    ...partyCommandBase,
    inviteId: z.uuid(),
  })
  .strict();

export type PartyDeclineCommand = z.infer<typeof partyDeclineCommandSchema>;

export const partyLeaveCommandSchema = z.object(partyCommandBase).strict();

export type PartyLeaveCommand = z.infer<typeof partyLeaveCommandSchema>;
