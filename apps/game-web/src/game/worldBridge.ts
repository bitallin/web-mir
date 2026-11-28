import type {
  CharacterClip,
  CombatEvent,
  CombatTargetChanged,
  CommandAck,
  LootClaimed,
  TilePoint,
} from '@web-legend/contracts';

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

/** A monster attack warning currently drawn on the ground. */
export type TelegraphView = {
  monsterId: string;
  x: number;
  y: number;
  radiusTiles: number;
  remainingMs: number;
};

/** A pending arrival objective drawn in the world (TD-CLI-24). */
export type ReachMarkerView = {
  questId: string;
  title: string;
  tile: TilePoint;
  radiusTiles: number;
};

/** A world-space name plate after decluttering; used by E2E and diagnostics. */
export type WorldLabelView = {
  id: string;
  kind: 'player' | 'monster' | 'npc';
  text: string;
  visible: boolean;
  rect: { x: number; y: number; width: number; height: number };
};

/** The part of the Phaser scene the session layer is allowed to touch. */
export type WorldSceneHandle = {
  applySnapshot: (data: SceneSnapshot) => void;
  applyAck: (ack: CommandAck) => void;
  applyAutoAttackState: (state: CombatTargetChanged) => void;
  selfUnitPosition: () => { x: number; y: number } | null;
  selfServerPosition: () => { x: number; y: number } | null;
  applyCombatEvent: (event: CombatEvent) => void;
  playLootClaim: (claimed: LootClaimed) => void;
  screenPointForTile: (tile: TilePoint) => ScreenPoint;
  monsterScreenPoint: (monsterId: string) => ScreenPoint | null;
  playerScreenPoint: (playerId: string) => ScreenPoint | null;
  playerAppearance: (playerId: string) => PlayerAppearance | null;
  activeTelegraphs: () => TelegraphView[];
  npcScreenPoint: (npcId: string) => ScreenPoint | null;
  lootScreenPoint: (dropId: string) => ScreenPoint | null;
  lootIconFrame: (dropId: string) => number | null;
  setQuestMarkers: (markers: readonly ReachMarkerView[]) => void;
  questMarkerScreenPoint: (questId: string) => ScreenPoint | null;
  questMarkers: () => ReachMarkerView[];
  labels: () => WorldLabelView[];
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
  private latestQuestMarkers: readonly ReachMarkerView[] = [];
  private attachCount = 0;

  onMoveRequest: ((tile: TilePoint) => void) | null = null;
  onStopRequest: (() => void) | null = null;
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
    scene.setQuestMarkers(this.latestQuestMarkers);
  }

  detach(scene: WorldSceneHandle): void {
    if (this.scene === scene) {
      this.scene = null;
    }
  }

  /** Drops the last snapshot when the map instance changes. */
  reset(): void {
    this.latestSnapshot = null;
    this.latestQuestMarkers = [];
  }

  pushSnapshot(data: SceneSnapshot): void {
    this.latestSnapshot = data;
    this.scene?.applySnapshot(data);
  }

  pushAck(ack: CommandAck): void {
    this.scene?.applyAck(ack);
  }

  applyCombatTargetChanged(state: CombatTargetChanged): void {
    this.scene?.applyAutoAttackState(state);
  }

  selfUnitPosition(): { x: number; y: number } | null {
    return this.scene?.selfUnitPosition() ?? null;
  }

  selfServerPosition(): { x: number; y: number } | null {
    return this.scene?.selfServerPosition() ?? null;
  }

  pushCombatEvent(event: CombatEvent): void {
    this.scene?.applyCombatEvent(event);
  }

  playLootClaim(claimed: LootClaimed): void {
    this.scene?.playLootClaim(claimed);
  }

  requestMove(tile: TilePoint): void {
    this.onMoveRequest?.(tile);
  }

  requestStop(): void {
    this.onStopRequest?.();
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

  activeTelegraphs(): TelegraphView[] {
    return this.scene?.activeTelegraphs() ?? [];
  }

  lootScreenPoint(dropId: string): ScreenPoint | null {
    return this.scene?.lootScreenPoint(dropId) ?? null;
  }

  lootIconFrame(dropId: string): number | null {
    return this.scene?.lootIconFrame(dropId) ?? null;
  }

  setQuestMarkers(markers: readonly ReachMarkerView[]): void {
    this.latestQuestMarkers = markers;
    this.scene?.setQuestMarkers(markers);
  }

  questMarkerScreenPoint(questId: string): ScreenPoint | null {
    return this.scene?.questMarkerScreenPoint(questId) ?? null;
  }

  questMarkers(): ReachMarkerView[] {
    return this.scene?.questMarkers() ?? [];
  }

  labels(): WorldLabelView[] {
    return this.scene?.labels() ?? [];
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
