import type { CharacterClip, CombatEvent, CommandAck, TilePoint } from '@web-legend/contracts';

import type { WorldSnapshot } from '../net/worldClient';
import type { ScreenPoint } from './projection';

export type SceneSnapshot = {
  snapshot: WorldSnapshot;
  selfId: string;
};

/** What the E2E diagnostics read back from a rendered player. */
export type PlayerAppearance = {
  textureKey: string;
  clip: CharacterClip;
  frame: string;
};

/** The part of the Phaser scene the session layer is allowed to touch. */
export type WorldSceneHandle = {
  applySnapshot: (data: SceneSnapshot) => void;
  applyAck: (ack: CommandAck) => void;
  applyCombatEvent: (event: CombatEvent) => void;
  screenPointForTile: (tile: TilePoint) => ScreenPoint;
  monsterScreenPoint: (monsterId: string) => ScreenPoint | null;
  playerScreenPoint: (playerId: string) => ScreenPoint | null;
  playerAppearance: (playerId: string) => PlayerAppearance | null;
  npcScreenPoint: (npcId: string) => ScreenPoint | null;
  lootScreenPoint: (dropId: string) => ScreenPoint | null;
  selectEntity: (entityId: string) => void;
  restart: () => void;
};

/**
 * Decouples the Phaser scene lifecycle from the network/session lifecycle.
 * A scene that restarts re-attaches and receives the latest snapshot.
 */
export class WorldBridge {
  private scene: WorldSceneHandle | null = null;
  private latestSnapshot: SceneSnapshot | null = null;
  private attachCount = 0;

  onMoveRequest: ((tile: TilePoint) => void) | null = null;
  onAttackRequest: ((targetId: string) => void) | null = null;
  onSkillRequest: ((skillId: string, targetId: string) => void) | null = null;
  onTargetChange: ((targetId: string | null) => void) | null = null;
  onPickupRequest: ((dropId: string) => void) | null = null;
  onNpcInteract: ((npcId: string) => void) | null = null;

  attach(scene: WorldSceneHandle): void {
    this.scene = scene;
    this.attachCount += 1;
    if (this.latestSnapshot !== null) {
      scene.applySnapshot(this.latestSnapshot);
    }
  }

  detach(scene: WorldSceneHandle): void {
    if (this.scene === scene) {
      this.scene = null;
    }
  }

  /** Drops the last snapshot when the map instance changes. */
  reset(): void {
    this.latestSnapshot = null;
  }

  pushSnapshot(data: SceneSnapshot): void {
    this.latestSnapshot = data;
    this.scene?.applySnapshot(data);
  }

  pushAck(ack: CommandAck): void {
    this.scene?.applyAck(ack);
  }

  pushCombatEvent(event: CombatEvent): void {
    this.scene?.applyCombatEvent(event);
  }

  requestMove(tile: TilePoint): void {
    this.onMoveRequest?.(tile);
  }

  requestAttack(targetId: string): void {
    this.onAttackRequest?.(targetId);
  }

  requestSkill(skillId: string, targetId: string): void {
    this.onSkillRequest?.(skillId, targetId);
  }

  notifyTarget(targetId: string | null): void {
    this.onTargetChange?.(targetId);
  }

  requestPickup(dropId: string): void {
    this.onPickupRequest?.(dropId);
  }

  requestNpcInteraction(npcId: string): void {
    this.onNpcInteract?.(npcId);
  }

  screenPointForTile(tile: TilePoint): ScreenPoint | null {
    return this.scene?.screenPointForTile(tile) ?? null;
  }

  monsterScreenPoint(monsterId: string): ScreenPoint | null {
    return this.scene?.monsterScreenPoint(monsterId) ?? null;
  }

  playerScreenPoint(playerId: string): ScreenPoint | null {
    return this.scene?.playerScreenPoint(playerId) ?? null;
  }

  playerAppearance(playerId: string): PlayerAppearance | null {
    return this.scene?.playerAppearance(playerId) ?? null;
  }

  lootScreenPoint(dropId: string): ScreenPoint | null {
    return this.scene?.lootScreenPoint(dropId) ?? null;
  }

  npcScreenPoint(npcId: string): ScreenPoint | null {
    return this.scene?.npcScreenPoint(npcId) ?? null;
  }

  selectTarget(entityId: string): void {
    this.scene?.selectEntity(entityId);
  }

  sceneGeneration(): number {
    return this.attachCount;
  }

  restartScene(): boolean {
    if (this.scene === null) {
      return false;
    }
    this.scene.restart();
    return true;
  }
}
