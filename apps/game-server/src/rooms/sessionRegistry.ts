import type { Client } from '@colyseus/core';
import type { StateView } from '@colyseus/schema';
import type {
  AssetCommandKind,
  CombatEvent,
  CommandAck,
  InventorySnapshot,
  TilePoint,
} from '@web-legend/contracts';
import type { QuestRecordState } from '@web-legend/game-domain';

import type { TokenBucket } from '../world/rateLimiter';

export type AutoAttackState = {
  targetId: string;
  phase: 'engaged' | 'approaching' | 'attacking';
  /** Combat-world time (ms) before which the next swing must not be attempted. */
  nextAttackAt: number;
  /** Combat-world time (ms) before which the approach must not be repathed. */
  nextRepathAt: number;
  /** Destination tile of the current approach path; a repath is only needed
   * when the target leaves it or the path runs out. */
  pathTargetTile: TilePoint | null;
};

/**
 * Per-connection state owned by the room. Extracted from `WorldMapRoom` so the
 * session lifecycle (join, reconnect, moderation, leave) has one owner that can
 * be tested without a live Colyseus room (TD-SRV-01).
 */
export type SessionRecord = {
  client: Client;
  playerId: string;
  accountId: string;
  displayName: string;
  mutedUntil: number | null;
  lastSequence: number;
  recentAcks: Map<string, CommandAck>;
  rateBucket: TokenBucket;
  chatBucket: TokenBucket;
  recentChatIds: Set<string>;
  recentCombat: Map<string, CombatEvent[]>;
  recentAssets: Map<string, AssetCommandKind>;
  recentAutoCommands: Map<string, true>;
  /** Server-owned auto-attack loop; null when the player is not attacking. */
  autoAttack: AutoAttackState | null;
  /** Last committed private asset state, merged with live vitals on send. */
  assetSnapshot: InventorySnapshot;
  /** Committed quest rows, keyed by content quest id (ADR-034). */
  questRecords: Map<string, QuestRecordState>;
  /** Party command ids already applied by this session (ADR-035). */
  recentParty: Map<string, true>;
  hp: number;
  mp: number;
  /** Set by a moderator disconnect; such a session never enters the grace window. */
  terminated: 'kicked' | 'banned' | null;
  transferring: boolean;
  transferTargetMapId: string | null;
  checkpointing: boolean;
  lastCheckpointAt: number;
  view: StateView;
  visible: Set<string>;
};

/**
 * Two indexes over the same session records: transport session id and
 * character id. Keeping them in one object prevents the maps from drifting
 * apart when a session is removed through the reconnect or transfer path.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sessionByPlayer = new Map<string, string>();

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  sessionIdForPlayer(playerId: string): string | undefined {
    return this.sessionByPlayer.get(playerId);
  }

  hasPlayer(playerId: string): boolean {
    return this.sessionByPlayer.has(playerId);
  }

  findByPlayerId(playerId: string): SessionRecord | undefined {
    const sessionId = this.sessionByPlayer.get(playerId);
    return sessionId === undefined ? undefined : this.sessions.get(sessionId);
  }

  add(session: SessionRecord): void {
    this.sessions.set(session.client.sessionId, session);
    this.sessionByPlayer.set(session.playerId, session.client.sessionId);
  }

  remove(sessionId: string): SessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return undefined;
    }
    this.sessions.delete(sessionId);
    if (this.sessionByPlayer.get(session.playerId) === sessionId) {
      this.sessionByPlayer.delete(session.playerId);
    }
    return session;
  }

  all(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  get size(): number {
    return this.sessions.size;
  }
}
