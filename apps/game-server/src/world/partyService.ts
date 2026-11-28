import type { ChatMessage, PartyInviteView } from '@web-legend/contracts';

import {
  PartyRegistry,
  type PartyAcceptResult,
  type PartyInviteRecord,
  type PartyInviteResult,
  type PartyKickResult,
  type PartyLeaderChangeResult,
  type PartyLeaveResult,
  type PartyState,
} from './partyRegistry';
import type { PlayerDirectory } from './playerDirectory';

/**
 * One party table per game-server process (ADR-036). A map room owns its
 * sessions and combat state, but a party must survive the leave/join cycle a
 * map transfer performs, so membership lives above the rooms. Player presence
 * and cross-room routing belong to the shared `PlayerDirectory` (TD-SRV-14).
 */

export type PartyServiceOptions = {
  directory: PlayerDirectory;
  maxMembers?: number;
  now?: () => number;
  inviteTtlMs?: number;
};

const DEFAULT_MAX_MEMBERS = 4;

export class PartyService {
  private readonly registry: PartyRegistry;
  private readonly directory: PlayerDirectory;

  constructor(options: PartyServiceOptions) {
    this.directory = options.directory;
    this.registry = new PartyRegistry({
      maxMembers: options.maxMembers ?? DEFAULT_MAX_MEMBERS,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.inviteTtlMs === undefined ? {} : { inviteTtlMs: options.inviteTtlMs }),
    });
  }

  get maxMembers(): number {
    return this.registry.maxMembers;
  }

  /** The shared directory this service routes through. */
  get routing(): PlayerDirectory {
    return this.directory;
  }

  /** Party size comes from content, which is only known after the store starts. */
  setMaxMembers(maxMembers: number): void {
    this.registry.setMaxMembers(maxMembers);
  }

  partyOf(playerId: string): PartyState | undefined {
    return this.registry.partyOf(playerId);
  }

  isMember(playerId: string): boolean {
    return this.registry.isMember(playerId);
  }

  createInvite(fromPlayerId: string, toPlayerId: string): PartyInviteResult {
    return this.registry.createInvite(fromPlayerId, toPlayerId);
  }

  /** Routes an invitation to whichever room hosts the invited player. */
  notifyInvite(invite: PartyInviteRecord): void {
    const sender = this.directory.presenceOf(invite.fromPlayerId);
    const view: PartyInviteView = {
      inviteId: invite.inviteId,
      fromPlayerId: invite.fromPlayerId,
      fromDisplayName: sender?.displayName ?? '玩家',
      expiresAt: invite.expiresAt,
      serverTime: Date.now(),
    };
    this.directory.deliver(invite.toPlayerId, { kind: 'party.invite', invite: view });
  }

  pendingInviteFor(playerId: string): PartyInviteRecord | undefined {
    return this.registry.pendingInviteFor(playerId);
  }

  acceptInvite(inviteId: string, acceptingPlayerId: string): PartyAcceptResult {
    const result = this.registry.acceptInvite(inviteId, acceptingPlayerId);
    if (result.kind === 'joined') {
      this.refreshMembers(result.party.memberIds);
    }
    return result;
  }

  declineInvite(inviteId: string, decliningPlayerId: string): boolean {
    return this.registry.declineInvite(inviteId, decliningPlayerId);
  }

  /** Leaves the party but stays in the world, so presence is kept. */
  leave(playerId: string): PartyLeaveResult {
    const result = this.registry.leave(playerId);
    if (result.party !== null) {
      this.refreshMembers(result.party.memberIds);
    }
    return result;
  }

  transferLeader(actorId: string, targetId: string): PartyLeaderChangeResult {
    const result = this.registry.transferLeader(actorId, targetId);
    if (result.kind === 'transferred') {
      this.refreshMembers(result.party.memberIds);
    }
    return result;
  }

  /**
   * A kicked player is no longer a member, so the regular member refresh would
   * skip them; they are routed by presence instead to clear their roster.
   */
  kick(actorId: string, targetId: string): PartyKickResult {
    const result = this.registry.kick(actorId, targetId);
    if (result.kind === 'kicked') {
      this.refreshMembers([result.kickedId, ...result.party.memberIds]);
    }
    return result;
  }

  /**
   * Party chat follows membership, not the map: each member is delivered by
   * whichever room currently hosts them, so a party split across maps still
   * talks. A member between rooms has no room and misses the message.
   */
  deliverChat(playerIds: readonly string[], message: ChatMessage): void {
    this.directory.deliverMany(playerIds, { kind: 'chat', message });
  }

  expireInvites(): void {
    this.registry.expireInvites();
  }

  /** Re-sends the roster to every room that currently hosts one of the players. */
  refreshMembers(playerIds: readonly string[]): void {
    for (const playerId of playerIds) {
      this.directory.deliver(playerId, { kind: 'party.refresh' });
    }
  }
}
