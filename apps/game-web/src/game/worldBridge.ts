import type { CommandAck, TilePoint } from '@web-legend/contracts';

import type { WorldSnapshot } from '../net/worldClient';
import type { ScreenPoint } from './projection';

export type SceneSnapshot = {
  snapshot: WorldSnapshot;
  selfId: string;
};

/** The part of the Phaser scene the session layer is allowed to touch. */
export type WorldSceneHandle = {
  applySnapshot: (data: SceneSnapshot) => void;
  applyAck: (ack: CommandAck) => void;
  screenPointForTile: (tile: TilePoint) => ScreenPoint;
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

  pushSnapshot(data: SceneSnapshot): void {
    this.latestSnapshot = data;
    this.scene?.applySnapshot(data);
  }

  pushAck(ack: CommandAck): void {
    this.scene?.applyAck(ack);
  }

  requestMove(tile: TilePoint): void {
    this.onMoveRequest?.(tile);
  }

  screenPointForTile(tile: TilePoint): ScreenPoint | null {
    return this.scene?.screenPointForTile(tile) ?? null;
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
