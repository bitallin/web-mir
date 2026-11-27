import type { CharacterClass, PartyInviteView } from '@web-legend/contracts';

import {
  PartyRegistry,
  type PartyAcceptResult,
  type PartyInviteRecord,
  type PartyInviteResult,
  type PartyLeaveResult,
  type PartyState,
} from './partyRegistry';

/**
 * One party table per game-server process (ADR-036). A map room owns its
 * sessions and combat state, but a party must survive the leave/join cycle a
 * map transfer performs, so membership lives above the rooms. Presence is
 * pushed by the room that currently hosts a member; a member between rooms is
 * kept in the roster as disconnected until the next room reports in.
 */

export type PartyMemberPresence = {
  playerId: string;
  displayName: string;
  classId: CharacterClass;
  level: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  connected: boolean;
  roomId: string | null;
};

/** What a room lets the service do to its players. */
export type PartyRoomPort = {
  sendInvite: (playerId: string, invite: PartyInviteView) => void;
  /** Re-send each listed player's roster snapshot when they are hosted here. */
  refresh: (playerIds: readonly string[]) => void;
};

export type PartyServiceOptions = {
  maxMembers?: number;
  now?: () => number;
  inviteTtlMs?: number;
};

const DEFAULT_MAX_MEMBERS = 4;

export class PartyService {
  private readonly registry: PartyRegistry;
  private readonly presence = new Map<string, PartyMemberPresence>();
  private readonly ports = new Map<string, PartyRoomPort>();

  constructor(options: PartyServiceOptions = {}) {
    this.registry = new PartyRegistry({
      maxMembers: options.maxMembers ?? DEFAULT_MAX_MEMBERS,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.inviteTtlMs === undefined ? {} : { inviteTtlMs: options.inviteTtlMs }),
    });
  }

  get maxMembers(): number {
    return this.registry.maxMembers;
  }

  /** Party size comes from content, which is only known after the store starts. */
  setMaxMembers(maxMembers: number): void {
    this.registry.setMaxMembers(maxMembers);
  }

  registerRoom(roomId: string, port: PartyRoomPort): void {
    this.ports.set(roomId, port);
  }

  unregisterRoom(roomId: string): void {
    this.ports.delete(roomId);
  }

  partyOf(playerId: string): PartyState | undefined {
    return this.registry.partyOf(playerId);
  }

  isMember(playerId: string): boolean {
    return this.registry.isMember(playerId);
  }

  presenceOf(playerId: string): PartyMemberPresence | undefined {
    return this.presence.get(playerId);
  }

  setPresence(presence: PartyMemberPresence): void {
    this.presence.set(presence.playerId, presence);
  }

  /**
   * A transferring member stays in the party but has no room; the roster shows
   * them as disconnected until the destination room reports presence.
   */
  markOffline(playerId: string): void {
    const presence = this.presence.get(playerId);
    if (presence === undefined) {
      return;
    }
    this.presence.set(playerId, { ...presence, connected: false, roomId: null });
  }

  createInvite(fromPlayerId: string, toPlayerId: string): PartyInviteResult {
    return this.registry.createInvite(fromPlayerId, toPlayerId);
  }

  /** Routes an invitation to whichever room hosts the invited player. */
  notifyInvite(invite: PartyInviteRecord): void {
    const sender = this.presence.get(invite.fromPlayerId);
    const view: PartyInviteView = {
      inviteId: invite.inviteId,
      fromPlayerId: invite.fromPlayerId,
      fromDisplayName: sender?.displayName ?? '玩家',
      expiresAt: invite.expiresAt,
      serverTime: Date.now(),
    };
    this.portFor(invite.toPlayerId)?.sendInvite(invite.toPlayerId, view);
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

  /** The character is leaving the world for good: drop party and presence. */
  removePlayer(playerId: string): PartyLeaveResult {
    const result = this.leave(playerId);
    this.presence.delete(playerId);
    return result;
  }

  expireInvites(): void {
    this.registry.expireInvites();
  }

  /** Re-sends the roster to every room that currently hosts one of the players. */
  refreshMembers(playerIds: readonly string[]): void {
    const byRoom = new Map<string, string[]>();
    for (const playerId of playerIds) {
      const roomId = this.presence.get(playerId)?.roomId;
      if (roomId === null || roomId === undefined) {
        continue;
      }
      const members = byRoom.get(roomId);
      if (members === undefined) {
        byRoom.set(roomId, [playerId]);
      } else {
        members.push(playerId);
      }
    }
    for (const [roomId, members] of byRoom) {
      this.ports.get(roomId)?.refresh(members);
    }
  }

  private portFor(playerId: string): PartyRoomPort | undefined {
    const roomId = this.presence.get(playerId)?.roomId;
    return roomId === null || roomId === undefined ? undefined : this.ports.get(roomId);
  }
}
