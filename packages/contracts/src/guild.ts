import { z } from 'zod';

import { characterClassSchema } from './character';

/**
 * Guild wire contract (ADR-048). Membership is persistent, while the roster's
 * online state comes from the process-wide player directory and is merged into
 * the private snapshot. Nothing about a guild ever enters the public room
 * state, so a stranger cannot read another player's guild.
 */

export const GUILD_NAME_MIN_LENGTH = 2 as const;
export const GUILD_NAME_MAX_LENGTH = 12 as const;
/** Hard wire limit until guild size becomes content-driven (TD-ECO-05). */
export const GUILD_MEMBER_LIMIT = 30 as const;
/** An unanswered guild invite dies so it cannot be accepted minutes later. */
export const GUILD_INVITE_TTL_MS = 30_000;
/** Creation gate that keeps throwaway guilds out of the world (ADR-048 §4.2). */
export const GUILD_CREATE_MIN_LEVEL = 5;
/** Public directory bound; enough to browse a realm without paging (ADR-049). */
export const GUILD_DIRECTORY_MAX = 50 as const;
/** The leader sees at most this many pending applications in one snapshot. */
export const GUILD_APPLICATION_LIST_MAX = 100 as const;

/** Case-insensitive uniqueness key, mirroring character names (ADR-017). */
export function normalizeGuildName(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase();
}

export const guildNameSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim())
  .pipe(
    z
      .string()
      .min(GUILD_NAME_MIN_LENGTH)
      .max(GUILD_NAME_MAX_LENGTH)
      .regex(/^[\p{L}\p{N}_]+$/u, '行会名只能包含字母、数字、汉字和下划线'),
  );

export const guildMemberViewSchema = z
  .object({
    playerId: z.uuid(),
    displayName: z.string().min(1).max(32),
    classId: characterClassSchema,
    level: z.number().int().min(1).max(100),
    online: z.boolean(),
    alive: z.boolean(),
    leader: z.boolean(),
    /** Epoch ms; the roster keeps join order stable and shows tenure. */
    joinedAt: z.number().nonnegative(),
  })
  .strict();

export type GuildMemberView = z.infer<typeof guildMemberViewSchema>;

export const guildViewSchema = z
  .object({
    guildId: z.uuid(),
    name: z.string().min(GUILD_NAME_MIN_LENGTH).max(GUILD_NAME_MAX_LENGTH),
    leaderId: z.uuid(),
    memberLimit: z.number().int().min(2).max(GUILD_MEMBER_LIMIT),
    members: z.array(guildMemberViewSchema).min(1).max(GUILD_MEMBER_LIMIT),
  })
  .strict();

export type GuildView = z.infer<typeof guildViewSchema>;

/** A leader's private view of one pending join application (ADR-049). */
export const guildApplicationViewSchema = z
  .object({
    applicationId: z.uuid(),
    playerId: z.uuid(),
    displayName: z.string().min(1).max(32),
    classId: characterClassSchema,
    level: z.number().int().min(1).max(100),
    createdAt: z.number().nonnegative(),
  })
  .strict();

export type GuildApplicationView = z.infer<typeof guildApplicationViewSchema>;

/** Sent privately to a member; `guild` is null when the player has none. */
export const guildSnapshotSchema = z
  .object({
    guild: guildViewSchema.nullable(),
    /** Only populated for the leader; always empty for everyone else. */
    applications: z.array(guildApplicationViewSchema).max(GUILD_APPLICATION_LIST_MAX).default([]),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type GuildSnapshot = z.infer<typeof guildSnapshotSchema>;

/**
 * Public summary of one guild in the realm directory. Deliberately excludes the
 * roster, online state and applications (ADR-049 §4.1).
 */
export const guildSummaryViewSchema = z
  .object({
    guildId: z.uuid(),
    name: z.string().min(GUILD_NAME_MIN_LENGTH).max(GUILD_NAME_MAX_LENGTH),
    leaderName: z.string().min(1).max(32),
    memberCount: z.number().int().min(1).max(GUILD_MEMBER_LIMIT),
    memberLimit: z.number().int().min(2).max(GUILD_MEMBER_LIMIT),
    /** True when the local player already has a pending application. */
    applied: z.boolean(),
  })
  .strict();

export type GuildSummaryView = z.infer<typeof guildSummaryViewSchema>;

export const guildDirectorySchema = z
  .object({
    guilds: z.array(guildSummaryViewSchema).max(GUILD_DIRECTORY_MAX),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type GuildDirectory = z.infer<typeof guildDirectorySchema>;

/** Sent only to the invited player. */
export const guildInviteViewSchema = z
  .object({
    inviteId: z.uuid(),
    guildId: z.uuid(),
    guildName: z.string().min(GUILD_NAME_MIN_LENGTH).max(GUILD_NAME_MAX_LENGTH),
    fromPlayerId: z.uuid(),
    fromDisplayName: z.string().min(1).max(32),
    expiresAt: z.number().nonnegative(),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type GuildInviteView = z.infer<typeof guildInviteViewSchema>;

/**
 * Online/offline transitions of one guildmate. Level and class are present when
 * the player came online so a stale roster row can be refreshed without a full
 * snapshot.
 */
export const guildPresenceSchema = z
  .object({
    playerId: z.uuid(),
    online: z.boolean(),
    level: z.number().int().min(1).max(100).optional(),
    classId: characterClassSchema.optional(),
    alive: z.boolean().optional(),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type GuildPresence = z.infer<typeof guildPresenceSchema>;

/** Tells a client that its guild changed; it answers with `guild.list`. */
export const guildRefreshSchema = z
  .object({
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type GuildRefresh = z.infer<typeof guildRefreshSchema>;

const guildCommandBase = {
  protocolVersion: z.number().int().positive(),
  commandId: z.uuid(),
  clientSequence: z.number().int().min(0).max(2_147_483_647),
};

export const guildCreateCommandSchema = z
  .object({
    ...guildCommandBase,
    name: guildNameSchema,
  })
  .strict();

export type GuildCreateCommand = z.infer<typeof guildCreateCommandSchema>;

export const guildInviteCommandSchema = z
  .object({
    ...guildCommandBase,
    targetPlayerId: z.uuid(),
  })
  .strict();

export type GuildInviteCommand = z.infer<typeof guildInviteCommandSchema>;

export const guildAcceptCommandSchema = z
  .object({
    ...guildCommandBase,
    inviteId: z.uuid(),
  })
  .strict();

export type GuildAcceptCommand = z.infer<typeof guildAcceptCommandSchema>;

export const guildDeclineCommandSchema = z
  .object({
    ...guildCommandBase,
    inviteId: z.uuid(),
  })
  .strict();

export type GuildDeclineCommand = z.infer<typeof guildDeclineCommandSchema>;

export const guildLeaveCommandSchema = z.object(guildCommandBase).strict();

export type GuildLeaveCommand = z.infer<typeof guildLeaveCommandSchema>;

/** Only the leader may remove another member; the leader cannot kick self. */
export const guildKickCommandSchema = z
  .object({
    ...guildCommandBase,
    targetPlayerId: z.uuid(),
  })
  .strict();

export type GuildKickCommand = z.infer<typeof guildKickCommandSchema>;

export const guildDisbandCommandSchema = z.object(guildCommandBase).strict();

export type GuildDisbandCommand = z.infer<typeof guildDisbandCommandSchema>;

export const guildListCommandSchema = z.object(guildCommandBase).strict();

export type GuildListCommand = z.infer<typeof guildListCommandSchema>;

export const guildDirectoryCommandSchema = z.object(guildCommandBase).strict();

export type GuildDirectoryCommand = z.infer<typeof guildDirectoryCommandSchema>;

export const guildApplyCommandSchema = z
  .object({
    ...guildCommandBase,
    guildId: z.uuid(),
  })
  .strict();

export type GuildApplyCommand = z.infer<typeof guildApplyCommandSchema>;

/** Only the guild leader may accept a pending application. */
export const guildApplicationAcceptCommandSchema = z
  .object({
    ...guildCommandBase,
    applicationId: z.uuid(),
  })
  .strict();

export type GuildApplicationAcceptCommand = z.infer<typeof guildApplicationAcceptCommandSchema>;

export const guildApplicationDeclineCommandSchema = z
  .object({
    ...guildCommandBase,
    applicationId: z.uuid(),
  })
  .strict();

export type GuildApplicationDeclineCommand = z.infer<typeof guildApplicationDeclineCommandSchema>;
