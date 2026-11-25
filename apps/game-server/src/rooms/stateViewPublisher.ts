import type {
  LootStateInstance,
  MonsterStateInstance,
  PlayerStateInstance,
  WorldStateInstance,
} from '@web-legend/contracts/world-state';
import type { InterestManager } from '@web-legend/game-simulation';

import type { SessionRegistry } from './sessionRegistry';

type StateEntity = PlayerStateInstance | MonsterStateInstance | LootStateInstance;

/**
 * Applies AOI visibility to each client's Colyseus view. Only ids whose
 * visibility actually changed are written, so a tick with no cell crossing
 * produces no view operations. Isolating this from the room keeps the
 * connection lifecycle readable and lets view diffing be tested directly
 * (TD-SRV-01).
 */
export class StateViewPublisher {
  constructor(
    private readonly interest: InterestManager,
    private readonly state: WorldStateInstance,
    private readonly registry: SessionRegistry,
  ) {}

  refresh(playerIds: readonly string[]): void {
    for (const playerId of new Set(playerIds)) {
      const session = this.registry.findByPlayerId(playerId);
      if (session === undefined) {
        continue;
      }

      const desired = this.interest.visibleIdsFor(playerId);
      for (const visibleId of desired) {
        if (session.visible.has(visibleId)) {
          continue;
        }
        const entity = this.entity(visibleId);
        if (entity !== undefined) {
          session.view.add(entity);
          session.visible.add(visibleId);
        }
      }
      for (const visibleId of [...session.visible]) {
        if (desired.has(visibleId)) {
          continue;
        }
        const entity = this.entity(visibleId);
        if (entity !== undefined) {
          session.view.remove(entity);
        }
        session.visible.delete(visibleId);
      }
    }
  }

  private entity(entityId: string): StateEntity | undefined {
    return (
      this.state.players.get(entityId) ??
      this.state.monsters.get(entityId) ??
      this.state.loot.get(entityId)
    );
  }
}
