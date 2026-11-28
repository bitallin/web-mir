import type { FriendPresence } from '@web-legend/contracts';

/**
 * A friend list changes or a friend comes online. Delivery follows the
 * presence table (ADR-045): the room that currently hosts the player is the
 * only one that can reach their socket; a player between maps misses the
 * event and gets the truth from the next snapshot.
 */
export type FriendServerEvent =
  { type: 'refresh' } | { type: 'presence'; presence: FriendPresence };

export type FriendRoomPort = {
  notify: (playerId: string, event: FriendServerEvent) => void;
};

type PresenceLookup = (playerId: string) => { roomId: string | null } | undefined;

/** Process-wide router for friend events; one instance per game server. */
export class FriendNotifier {
  private readonly ports = new Map<string, FriendRoomPort>();

  constructor(private readonly presenceOf: PresenceLookup) {}

  registerRoom(roomId: string, port: FriendRoomPort): void {
    this.ports.set(roomId, port);
  }

  unregisterRoom(roomId: string): void {
    this.ports.delete(roomId);
  }

  /** The affected player's client answers by requesting a fresh snapshot. */
  notifyRefresh(playerId: string): void {
    this.send(playerId, { type: 'refresh' });
  }

  notifyPresence(playerId: string, presence: FriendPresence): void {
    this.send(playerId, { type: 'presence', presence });
  }

  private send(playerId: string, event: FriendServerEvent): void {
    const roomId = this.presenceOf(playerId)?.roomId;
    if (roomId === null || roomId === undefined) {
      return;
    }
    this.ports.get(roomId)?.notify(playerId, event);
  }
}
