import Phaser from 'phaser';
import {
  isTileWalkable,
  MAP_TILE_GRASS,
  PLAYER_SPEED_UNITS_PER_SECOND,
  TILE_UNITS,
  tileCharAt,
  type CommandAck,
  type MapManifest,
  type TilePoint,
} from '@web-legend/contracts';

import type { PlayerView } from '../net/worldClient';
import { createProjection, TILE_HEIGHT, TILE_WIDTH, type ScreenPoint } from './projection';
import { TECHNICAL_MAP } from './technicalMap';
import type { SceneSnapshot, WorldBridge, WorldSceneHandle } from './worldBridge';

const DISPLAY_FONT = '"Noto Serif SC", "Songti SC", "SimSun", Georgia, serif';
const WALL_HEIGHT = 22;
const MAX_FRAME_MS = 100;
const SNAP_DISTANCE_UNITS = 900;

const PLAYER_COLORS = [0x7fa8c9, 0xc98f6a, 0x8fbf8a, 0xb48fc9, 0xc9b56a, 0x6aa8a8];

type UnitPoint = { x: number; y: number };

function lerp(from: number, to: number, factor: number): number {
  return from + (to - from) * factor;
}

function toVector2(points: readonly { x: number; y: number }[]): Phaser.Math.Vector2[] {
  return points.map((point) => new Phaser.Math.Vector2(point.x, point.y));
}

function tileCenterUnits(tile: TilePoint): UnitPoint {
  return {
    x: tile.x * TILE_UNITS + TILE_UNITS / 2,
    y: tile.y * TILE_UNITS + TILE_UNITS / 2,
  };
}

class PlayerVisual {
  readonly container: Phaser.GameObjects.Container;
  readonly nameText: Phaser.GameObjects.Text;
  readonly isSelf: boolean;
  current: ScreenPoint = { x: 0, y: 0 };
  target: ScreenPoint = { x: 0, y: 0 };
  private initialized = false;

  constructor(scene: Phaser.Scene, displayName: string, colorIndex: number, isSelf: boolean) {
    this.isSelf = isSelf;
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] ?? PLAYER_COLORS[0] ?? 0x7fa8c9;

    const body = scene.add.graphics();
    body.fillStyle(0x000000, 0.35);
    body.fillEllipse(0, 0, 28, 12);
    if (isSelf) {
      body.lineStyle(2, 0xc9a227, 0.9);
      body.strokeEllipse(0, 0, 34, 16);
    }
    body.fillStyle(color, 1);
    body.fillPoints(
      toVector2([
        { x: -9, y: 0 },
        { x: 9, y: 0 },
        { x: 6, y: -26 },
        { x: -6, y: -26 },
      ]),
      true,
    );
    body.fillStyle(0x24211d, 1);
    body.fillRect(-7, -9, 14, 3);
    body.fillStyle(0xd8c3a5, 1);
    body.fillCircle(0, -33, 7);
    body.fillStyle(0x2b2118, 1);
    body.fillEllipse(0, -37, 15, 9);

    this.nameText = scene.add
      .text(0, -45, displayName, {
        fontFamily: DISPLAY_FONT,
        fontSize: '13px',
        color: isSelf ? '#e5c15a' : '#e8e0cd',
        stroke: '#0b0d10',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1);

    this.container = scene.add.container(0, 0, [body, this.nameText]);
  }

  setDisplayName(displayName: string): void {
    if (this.nameText.text !== displayName) {
      this.nameText.setText(displayName);
    }
  }

  setConnected(connected: boolean): void {
    this.container.setAlpha(connected ? 1 : 0.4);
  }

  setTarget(screen: ScreenPoint, immediate: boolean): void {
    this.target = screen;
    if (!this.initialized || immediate) {
      this.current = { ...screen };
      this.initialized = true;
      this.container.setPosition(screen.x, screen.y);
      this.container.setDepth(screen.y);
    }
  }

  update(deltaMs: number): void {
    const factor = 1 - Math.exp(-deltaMs / 70);
    this.current = {
      x: lerp(this.current.x, this.target.x, factor),
      y: lerp(this.current.y, this.target.y, factor),
    };
    this.container.setPosition(this.current.x, this.current.y);
    this.container.setDepth(this.current.y);
  }

  destroy(): void {
    this.container.destroy(true);
  }
}

/**
 * Phase 1 technical world scene: pseudo-isometric ground, foot-anchored players
 * with Y-depth sorting, server-driven remote interpolation, short local
 * prediction along the server-approved path, and intent-only input.
 */
export class WorldScene extends Phaser.Scene implements WorldSceneHandle {
  private readonly bridge: WorldBridge;
  private readonly map: MapManifest = TECHNICAL_MAP;
  private readonly projection = createProjection(TECHNICAL_MAP);
  private readonly visuals = new Map<string, PlayerVisual>();
  private pathGraphics!: Phaser.GameObjects.Graphics;
  private selfId: string | null = null;
  private predicted: UnitPoint | null = null;
  private path: UnitPoint[] = [];
  private speed: number = PLAYER_SPEED_UNITS_PER_SECOND;

  constructor(bridge: WorldBridge) {
    super('world');
    this.bridge = bridge;
  }

  create(): void {
    const camera = this.cameras.main;
    camera.setBackgroundColor('#0b0d10');
    camera.setBounds(0, 0, this.projection.mapWidth, this.projection.mapHeight);
    camera.centerOn(this.projection.mapWidth / 2, this.projection.mapHeight / 2);

    this.visuals.clear();
    this.selfId = null;
    this.predicted = null;
    this.path = [];

    this.drawGround();
    this.drawWalls();
    this.pathGraphics = this.add.graphics().setDepth(1);

    this.input.on('pointerdown', this.handlePointerDown, this);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off('pointerdown', this.handlePointerDown, this);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
      this.bridge.detach(this);
    });

    this.bridge.attach(this);
  }

  override update(_time: number, deltaMs: number): void {
    const delta = Math.min(Math.max(deltaMs, 0), MAX_FRAME_MS);
    this.advancePrediction(delta);

    if (this.predicted !== null) {
      const selfVisual = this.selfId === null ? undefined : this.visuals.get(this.selfId);
      selfVisual?.setTarget(this.projection.toScreen(this.predicted.x, this.predicted.y), true);
    }

    let focus: ScreenPoint | null = null;
    for (const visual of this.visuals.values()) {
      visual.update(delta);
      if (visual.isSelf) {
        focus = visual.current;
      }
    }

    if (focus !== null) {
      this.cameras.main.centerOn(focus.x, focus.y);
    }
  }

  applySnapshot(data: SceneSnapshot): void {
    this.selfId = data.selfId;
    const seen = new Set<string>();

    for (const player of data.snapshot.players) {
      seen.add(player.playerId);
      let visual = this.visuals.get(player.playerId);
      const isSelf = player.playerId === this.selfId;
      if (visual === undefined) {
        visual = new PlayerVisual(this, player.displayName, player.colorIndex, isSelf);
        this.visuals.set(player.playerId, visual);
      }
      visual.setDisplayName(player.displayName);
      visual.setConnected(player.connected);

      if (isSelf) {
        this.applySelfPosition(player);
      } else {
        visual.setTarget(this.projection.toScreen(player.x, player.y), false);
      }
    }

    for (const [playerId, visual] of this.visuals) {
      if (!seen.has(playerId)) {
        visual.destroy();
        this.visuals.delete(playerId);
      }
    }
  }

  applyAck(ack: CommandAck): void {
    this.speed = ack.speedUnitsPerSecond;
    if (this.predicted === null) {
      this.predicted = { x: ack.startX, y: ack.startY };
    }
    this.path = this.buildWaypoints(this.predicted, ack.path);
    this.drawPath(ack.path);
  }

  screenPointForTile(tile: TilePoint): ScreenPoint {
    const center = this.projection.tileCenter(tile);
    const camera = this.cameras.main;
    const canvas = this.game.canvas.getBoundingClientRect();
    return {
      x: center.x - camera.scrollX + canvas.left,
      y: center.y - camera.scrollY + canvas.top,
    };
  }

  restart(): void {
    this.scene.restart();
  }

  private applySelfPosition(player: PlayerView): void {
    if (this.predicted === null) {
      this.predicted = { x: player.x, y: player.y };
      return;
    }

    const error = Math.hypot(player.x - this.predicted.x, player.y - this.predicted.y);
    if (error > SNAP_DISTANCE_UNITS) {
      this.predicted = { x: player.x, y: player.y };
      this.path = [];
      this.pathGraphics.clear();
      return;
    }

    if (this.path.length === 0) {
      const factor = player.moving ? 0.5 : 0.25;
      this.predicted = {
        x: lerp(this.predicted.x, player.x, factor),
        y: lerp(this.predicted.y, player.y, factor),
      };
    }
  }

  private advancePrediction(deltaMs: number): void {
    const start = this.predicted;
    if (start === null || this.path.length === 0) {
      return;
    }

    let position: UnitPoint = { x: start.x, y: start.y };
    let budget = (this.speed * deltaMs) / 1_000;
    while (budget > 0) {
      const target = this.path[0];
      if (target === undefined) {
        break;
      }
      const deltaX: number = target.x - position.x;
      const deltaY: number = target.y - position.y;
      const distance = Math.abs(deltaX) + Math.abs(deltaY);

      if (distance <= budget) {
        position = { x: target.x, y: target.y };
        budget -= distance;
        this.path.shift();
      } else {
        position = {
          x: position.x + Math.sign(deltaX) * budget,
          y: position.y + Math.sign(deltaY) * budget,
        };
        budget = 0;
      }
    }

    this.predicted = position;
    if (this.path.length === 0) {
      this.pathGraphics.clear();
    }
  }

  /** Mirrors the server rule: move to the current tile center before turning. */
  private buildWaypoints(start: UnitPoint, path: readonly TilePoint[]): UnitPoint[] {
    const currentTile = {
      x: Math.floor(start.x / TILE_UNITS),
      y: Math.floor(start.y / TILE_UNITS),
    };
    const center = tileCenterUnits(currentTile);
    const waypoints: UnitPoint[] = [];
    if (start.x !== center.x || start.y !== center.y) {
      waypoints.push(center);
    }
    for (const node of path) {
      waypoints.push(tileCenterUnits(node));
    }
    return waypoints.filter((point) => point.x !== start.x || point.y !== start.y);
  }

  private drawGround(): void {
    const ground = this.add.graphics().setDepth(-10_000);
    for (let y = 0; y < this.map.height; y += 1) {
      for (let x = 0; x < this.map.width; x += 1) {
        const center = this.projection.tileCenter({ x, y });
        const grass = tileCharAt(this.map, x, y) === MAP_TILE_GRASS;
        const tone = (x + y) % 2 === 0;
        const color = grass ? (tone ? 0x2f3b2e : 0x344233) : tone ? 0x2b3034 : 0x272c30;

        ground.fillStyle(color, 1);
        ground.fillPoints(this.diamond(center.x, center.y), true);
        ground.lineStyle(1, 0x1a1d20, 0.7);
        ground.strokePoints(this.diamond(center.x, center.y), true);
      }
    }
  }

  private drawWalls(): void {
    for (let y = 0; y < this.map.height; y += 1) {
      for (let x = 0; x < this.map.width; x += 1) {
        if (isTileWalkable(this.map, x, y)) {
          continue;
        }
        const center = this.projection.tileCenter({ x, y });
        const wall = this.add.graphics();
        wall.setPosition(center.x, center.y);
        wall.setDepth(center.y + TILE_HEIGHT / 2 - 2);

        const leftFace = [
          { x: -TILE_WIDTH / 2, y: -WALL_HEIGHT },
          { x: 0, y: TILE_HEIGHT / 2 - WALL_HEIGHT },
          { x: 0, y: TILE_HEIGHT / 2 },
          { x: -TILE_WIDTH / 2, y: 0 },
        ];
        const rightFace = [
          { x: 0, y: TILE_HEIGHT / 2 - WALL_HEIGHT },
          { x: TILE_WIDTH / 2, y: -WALL_HEIGHT },
          { x: TILE_WIDTH / 2, y: 0 },
          { x: 0, y: TILE_HEIGHT / 2 },
        ];
        wall.fillStyle(0x30353a, 1);
        wall.fillPoints(toVector2(leftFace), true);
        wall.fillStyle(0x3a4046, 1);
        wall.fillPoints(toVector2(rightFace), true);

        const top = this.diamond(0, -WALL_HEIGHT);
        wall.fillStyle(0x4a5158, 1);
        wall.fillPoints(top, true);
        wall.lineStyle(1, 0x23272b, 1);
        wall.strokePoints(top, true);
      }
    }
  }

  private diamond(centerX: number, centerY: number): Phaser.Math.Vector2[] {
    return toVector2([
      { x: centerX, y: centerY - TILE_HEIGHT / 2 },
      { x: centerX + TILE_WIDTH / 2, y: centerY },
      { x: centerX, y: centerY + TILE_HEIGHT / 2 },
      { x: centerX - TILE_WIDTH / 2, y: centerY },
    ]);
  }

  private drawPath(path: readonly TilePoint[]): void {
    this.pathGraphics.clear();
    if (path.length === 0) {
      return;
    }
    this.pathGraphics.lineStyle(2, 0xc9a227, 0.28);
    this.pathGraphics.fillStyle(0xc9a227, 0.7);
    let previous: ScreenPoint | null = null;
    for (const node of path) {
      const screen = this.projection.tileCenter(node);
      if (previous !== null) {
        this.pathGraphics.lineBetween(previous.x, previous.y, screen.x, screen.y);
      }
      this.pathGraphics.fillCircle(screen.x, screen.y, 2.5);
      previous = screen;
    }
  }

  private readonly handlePointerDown = (pointer: Phaser.Input.Pointer): void => {
    const tile = this.projection.toTile(pointer.worldX, pointer.worldY);
    if (!isTileWalkable(this.map, tile.x, tile.y)) {
      this.showMarker(tile, 0xb04a3a);
      return;
    }
    this.showMarker(tile, 0xc9a227);
    this.bridge.requestMove(tile);
  };

  private showMarker(tile: TilePoint, color: number): void {
    const screen = this.projection.tileCenter(tile);
    const marker = this.add.graphics().setDepth(2);
    marker.lineStyle(2, color, 0.95);
    marker.strokeEllipse(screen.x, screen.y, TILE_WIDTH * 0.7, TILE_HEIGHT * 0.7);
    this.tweens.add({
      targets: marker,
      alpha: 0,
      duration: 650,
      onComplete: () => {
        marker.destroy();
      },
    });
  }

  private readonly handleResize = (): void => {
    const camera = this.cameras.main;
    camera.setBounds(0, 0, this.projection.mapWidth, this.projection.mapHeight);
  };
}
