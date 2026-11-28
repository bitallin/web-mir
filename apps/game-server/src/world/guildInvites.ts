import { GUILD_INVITE_TTL_MS, type GuildInviteView } from '@web-legend/contracts';
import { randomUUID } from 'node:crypto';

import type { PlayerDirectory } from './playerDirectory';

/**
 * Guild invitations for one game-server process (ADR-048). Membership itself
 * is persistent, but an unanswered invitation is transient social state like a
 * party invite: it is not worth a row and it must route to whichever map room
 * currently hosts the invitee.
 */

export type GuildInviteRecord = {
  inviteId: string;
  guildId: string;
  guildName: string;
  fromPlayerId: string;
  toPlayerId: string;
  expiresAt: number;
};

export type GuildInviteServiceOptions = {
  directory: PlayerDirectory;
  now?: () => number;
  inviteTtlMs?: number;
};

export class GuildInviteService {
  private readonly directory: PlayerDirectory;
  private readonly now: () => number;
  private readonly inviteTtlMs: number;
  private readonly invites = new Map<string, GuildInviteRecord>();
  /** One pending invite per target; a newer invite replaces the older one. */
  private readonly inviteIdByTarget = new Map<string, string>();

  constructor(options: GuildInviteServiceOptions) {
    this.directory = options.directory;
    this.now = options.now ?? (() => Date.now());
    this.inviteTtlMs = options.inviteTtlMs ?? GUILD_INVITE_TTL_MS;
  }

  createInvite(input: {
    guildId: string;
    guildName: string;
    fromPlayerId: string;
    toPlayerId: string;
  }): GuildInviteRecord {
    const existing = this.inviteIdByTarget.get(input.toPlayerId);
    if (existing !== undefined) {
      this.invites.delete(existing);
    }
    const invite: GuildInviteRecord = {
      inviteId: randomUUID(),
      guildId: input.guildId,
      guildName: input.guildName,
      fromPlayerId: input.fromPlayerId,
      toPlayerId: input.toPlayerId,
      expiresAt: this.now() + this.inviteTtlMs,
    };
    this.invites.set(invite.inviteId, invite);
    this.inviteIdByTarget.set(invite.toPlayerId, invite.inviteId);
    return invite;
  }

  /** Routes an invitation to whichever room hosts the invited player. */
  notifyInvite(invite: GuildInviteRecord): boolean {
    const sender = this.directory.presenceOf(invite.fromPlayerId);
    const view: GuildInviteView = {
      inviteId: invite.inviteId,
      guildId: invite.guildId,
      guildName: invite.guildName,
      fromPlayerId: invite.fromPlayerId,
      fromDisplayName: sender?.displayName ?? '玩家',
      expiresAt: invite.expiresAt,
      serverTime: Date.now(),
    };
    return this.directory.deliver(invite.toPlayerId, { kind: 'guild.invite', invite: view });
  }

  /** Returns the pending invite for a player, dropping it once expired. */
  pendingInviteFor(playerId: string): GuildInviteRecord | undefined {
    const inviteId = this.inviteIdByTarget.get(playerId);
    if (inviteId === undefined) {
      return undefined;
    }
    const invite = this.invites.get(inviteId);
    if (invite === undefined || invite.expiresAt <= this.now()) {
      this.invites.delete(inviteId);
      this.inviteIdByTarget.delete(playerId);
      return undefined;
    }
    return invite;
  }

  /** Consumes an invite; only the addressed player may accept it. */
  consumeInvite(inviteId: string, playerId: string): GuildInviteRecord | null {
    const invite = this.invites.get(inviteId);
    if (invite === undefined || invite.toPlayerId !== playerId || invite.expiresAt <= this.now()) {
      return null;
    }
    this.invites.delete(inviteId);
    this.inviteIdByTarget.delete(invite.toPlayerId);
    return invite;
  }

  declineInvite(inviteId: string, playerId: string): boolean {
    const invite = this.invites.get(inviteId);
    if (invite === undefined || invite.toPlayerId !== playerId || invite.expiresAt <= this.now()) {
      return false;
    }
    this.invites.delete(inviteId);
    this.inviteIdByTarget.delete(invite.toPlayerId);
    return true;
  }

  expireInvites(): void {
    const now = this.now();
    for (const [inviteId, invite] of this.invites) {
      if (invite.expiresAt <= now) {
        this.invites.delete(inviteId);
        this.inviteIdByTarget.delete(invite.toPlayerId);
      }
    }
  }
}
