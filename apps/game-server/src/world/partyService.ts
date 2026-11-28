import {
  RECENT_TEAMMATES_MAX,
  type CharacterClass,
  type ChatMessage,
  type PartyInviteView,
} from '@web-legend/contracts';

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

/**
 * A former party member, kept so the player can invite them again from any
 * map without a global player search (ADR-047).
 */
export type RecentTeammateRecord = {
  playerId: string;
  displayName: string;
  classId: CharacterClass;
  level: number;
  lastPlayedAt: number;
};

const DEFAULT_MAX_MEMBERS = 4;

export class PartyService {
  private readonly registry: PartyRegistry;
  private readonly directory: PlayerDirectory;
  private readonly now: () => number;
  /** playerId -> teammateId -> record; process memory only, bounded per player. */
  private readonly recent = new Map<string, Map<string, RecentTeammateRecord>>();

  constructor(options: PartyServiceOptions) {
    this.directory = options.directory;
    this.now = options.now ?? (() => Date.now());
    this.registry = new PartyRegistry({
      maxMembers: options.maxMembers ?? DEFAULT_MAX_MEMBERS,
      now: this.now,
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
      this.recordTeam(result.party.memberIds);
      this.refreshMembers(result.party.memberIds);
    }
    return result;
  }

  /**
   * Only a party the player actually joined creates a record, so the list can
   * never become a directory of everyone who is online. A member between maps
   * has no presence and is skipped until the next join refreshes the pair.
   */
  private recordTeam(memberIds: readonly string[]): void {
    const at = this.now();
    for (const memberId of memberIds) {
      const member = this.directory.presenceOf(memberId);
      if (member === undefined) {
        continue;
      }
      let bucket = this.recent.get(memberId);
      if (bucket === undefined) {
        bucket = new Map();
        this.recent.set(memberId, bucket);
      }
      for (const teammateId of memberIds) {
        if (teammateId === memberId) {
          continue;
        }
        const teammate = this.directory.presenceOf(teammateId);
        if (teammate === undefined) {
          continue;
        }
        bucket.set(teammateId, {
          playerId: teammateId,
          displayName: teammate.displayName,
          classId: teammate.classId,
          level: teammate.level,
          lastPlayedAt: at,
        });
      }
      trimRecent(bucket);
    }
  }

  /** Most recent first; used to fill the private friend snapshot. */
  recentPartners(playerId: string): RecentTeammateRecord[] {
    const bucket = this.recent.get(playerId);
    if (bucket === undefined) {
      return [];
    }
    return [...bucket.values()].sort((left, right) => right.lastPlayedAt - left.lastPlayedAt);
  }

  /** Authorizes a cross-map invite to someone the player has partied with. */
  knowsTeammate(actorId: string, targetId: string): boolean {
    return this.recent.get(actorId)?.has(targetId) ?? false;
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

function trimRecent(bucket: Map<string, RecentTeammateRecord>): void {
  if (bucket.size <= RECENT_TEAMMATES_MAX) {
    return;
  }
  const oldestFirst = [...bucket.values()].sort(
    (left, right) => left.lastPlayedAt - right.lastPlayedAt,
  );
  for (const record of oldestFirst.slice(0, bucket.size - RECENT_TEAMMATES_MAX)) {
    bucket.delete(record.playerId);
  }
}
