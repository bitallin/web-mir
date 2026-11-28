import type {
  CharacterClass,
  ChatMessage,
  FriendPresence,
  PartyInviteView,
} from '@web-legend/contracts';

/**
 * One presence and routing table per game-server process. A map room owns its
 * sessions, but a player must stay reachable while transferring between maps
 * and when a party, friend or whisper message comes from another room. The
 * room that currently hosts a player registers a port; delivery follows
 * presence, so an intermediary map cannot claim it (ADR-046, TD-SRV-14).
 */

export type PlayerPresence = {
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

export type FriendServerEvent =
  { type: 'refresh' } | { type: 'presence'; presence: FriendPresence };

/**
 * Cross-room messages. Rooms decode and send them; the directory only decides
 * which room can reach the player.
 */
export type PlayerDelivery =
  | { kind: 'chat'; message: ChatMessage }
  | { kind: 'party.invite'; invite: PartyInviteView }
  | { kind: 'party.refresh' }
  | { kind: 'friend.event'; event: FriendServerEvent };

export type PlayerRoomPort = {
  deliver: (playerId: string, delivery: PlayerDelivery) => void;
};

export class PlayerDirectory {
  private readonly presence = new Map<string, PlayerPresence>();
  private readonly ports = new Map<string, PlayerRoomPort>();

  registerRoom(roomId: string, port: PlayerRoomPort): void {
    this.ports.set(roomId, port);
  }

  unregisterRoom(roomId: string): void {
    this.ports.delete(roomId);
  }

  presenceOf(playerId: string): PlayerPresence | undefined {
    return this.presence.get(playerId);
  }

  setPresence(presence: PlayerPresence): void {
    this.presence.set(presence.playerId, presence);
  }

  /**
   * A transferring player stays in the directory but has no room; rosters show
   * them as disconnected until the destination room reports presence.
   */
  markOffline(playerId: string): void {
    const presence = this.presence.get(playerId);
    if (presence === undefined) {
      return;
    }
    this.presence.set(playerId, { ...presence, connected: false, roomId: null });
  }

  /** The character is leaving the world for good. */
  removePlayer(playerId: string): void {
    this.presence.delete(playerId);
  }

  /** Delivers one event to the room that hosts the player, if any. */
  deliver(playerId: string, delivery: PlayerDelivery): boolean {
    const presence = this.presence.get(playerId);
    if (presence === undefined || presence.roomId === null) {
      return false;
    }
    const port = this.ports.get(presence.roomId);
    if (port === undefined) {
      return false;
    }
    port.deliver(playerId, delivery);
    return true;
  }

  deliverMany(playerIds: readonly string[], delivery: PlayerDelivery): void {
    for (const playerId of playerIds) {
      this.deliver(playerId, delivery);
    }
  }

  roomIdOf(playerId: string): string | null {
    return this.presence.get(playerId)?.roomId ?? null;
  }
}
