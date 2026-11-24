import Phaser from 'phaser';
import {
  PLAYER_SPEED_UNITS_PER_SECOND,
  TILE_UNITS,
  type CombatEvent,
  type CommandAck,
  type TilePoint,
} from '@web-legend/contracts';

import type { PlayerView } from '../net/worldClient';
import { createProjection, TILE_HEIGHT, TILE_WIDTH, type ScreenPoint } from './projection';
import type { MapBundle } from './mapCatalog';
import { MonsterVisual } from './MonsterVisual';
import type { SceneSnapshot, WorldBridge, WorldSceneHandle } from './worldBridge';

const DISPLAY_FONT = '"Noto Serif SC", "Songti SC", "SimSun", Georgia, serif';
const WALL_HEIGHT = 24;
const MAX_FRAME_MS = 100;
const SNAP_DISTANCE_UNITS = 900;
const GROUND_DEPTH = -10_000;
const WALK_ANIMATION_MS = 150;
/** Keeps the player and adjacent monsters above the bottom combat HUD. */
const CAMERA_LIFT_PX = 200;

const PLAYER_COLORS = [0x9fc4e0, 0xe0b087, 0xa8d6a1, 0xcf9fe0, 0xe0d18f, 0x8fd0d0];

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
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly isSelf: boolean;
  current: ScreenPoint = { x: 0, y: 0 };
  target: ScreenPoint = { x: 0, y: 0 };
  private initialized = false;
  private animationClock = 0;
  private facing = 2;
  private moving = false;
  private frameIndex = 0;

  constructor(
    scene: Phaser.Scene,
    displayName: string,
    colorIndex: number,
    isSelf: boolean,
    framePrefix: string,
  ) {
    this.isSelf = isSelf;
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] ?? PLAYER_COLORS[0] ?? 0x9fc4e0;

    this.sprite = scene.add
      .sprite(0, 0, 'characters', `${framePrefix}d2f0`)
      .setOrigin(0.5, 1)
      .setTint(color);

    this.nameText = scene.add
      .text(0, -50, displayName, {
        fontFamily: DISPLAY_FONT,
        fontSize: '13px',
        color: isSelf ? '#e5c15a' : '#e8e0cd',
        stroke: '#0b0d10',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1);

    this.container = scene.add.container(0, 0, [this.sprite, this.nameText]);
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

  setMotion(moving: boolean, facing: number): void {
    this.moving = moving;
    this.facing = ((facing % 4) + 4) % 4;
  }

  update(deltaMs: number, framePrefix: string): void {
    const factor = 1 - Math.exp(-deltaMs / 70);
    this.current = {
      x: lerp(this.current.x, this.target.x, factor),
      y: lerp(this.current.y, this.target.y, factor),
    };
    this.container.setPosition(this.current.x, this.current.y);
    this.container.setDepth(this.current.y);

    if (this.moving) {
      this.animationClock += deltaMs;
      this.frameIndex = Math.floor(this.animationClock / WALK_ANIMATION_MS) % 2;
    } else {
      this.animationClock = 0;
      this.frameIndex = 0;
    }
    this.sprite.setFrame(`${framePrefix}d${String(this.facing)}f${String(this.frameIndex)}`);
  }

  playAttack(): void {
    this.container.scene.tweens.add({
      targets: this.container,
      scaleX: 1.12,
      scaleY: 0.92,
      duration: 70,
      yoyo: true,
    });
  }

  playHit(): void {
    this.container.scene.tweens.add({
      targets: this.container,
      alpha: 0.45,
      duration: 70,
      yoyo: true,
    });
  }

  playDeath(): void {
    this.container.setAlpha(0.28);
  }

  playRespawn(): void {
    this.container.setAlpha(1);
    this.container.scene.tweens.add({
      targets: this.container,
      alpha: { from: 0.2, to: 1 },
      duration: 260,
    });
  }

  destroy(): void {
    this.container.destroy(true);
  }
}

/**
 * Phase-3 world scene. It renders the compiled map manifest with the asset
 * manifest's tileset, keeps foot-anchored players Y-sorted, and drives local
 * prediction only from server-approved paths.
 */
export class WorldScene extends Phaser.Scene implements WorldSceneHandle {
  private readonly bridge: WorldBridge;
  private readonly bundle: MapBundle;
  private readonly projection: ReturnType<typeof createProjection>;
  private readonly visuals = new Map<string, PlayerVisual>();
  private readonly monsterVisuals = new Map<string, MonsterVisual>();
  private pathGraphics!: Phaser.GameObjects.Graphics;
  private targetRing!: Phaser.GameObjects.Graphics;
  private selfId: string | null = null;
  private selectedTargetId: string | null = null;
  private predicted: UnitPoint | null = null;
  private path: UnitPoint[] = [];
  private speed: number = PLAYER_SPEED_UNITS_PER_SECOND;
  private readonly framePrefix = 'p';

  constructor(bridge: WorldBridge, bundle: MapBundle) {
    super('world');
    this.bridge = bridge;
    this.bundle = bundle;
    this.projection = createProjection(bundle.manifest);
  }

  preload(): void {
    this.load.image('terrain', this.bundle.terrainImageUrl);
    this.load.image('characters', this.bundle.playerImageUrl);
  }

  create(): void {
    this.registerTilesetFrames();
    this.registerCharacterFrames();

    const camera = this.cameras.main;
    camera.setBackgroundColor('#0b0d10');
    camera.setBounds(0, 0, this.projection.mapWidth, this.projection.mapHeight);
    camera.centerOn(this.projection.mapWidth / 2, this.projection.mapHeight / 2);

    this.visuals.clear();
    this.monsterVisuals.clear();
    this.selfId = null;
    this.selectedTargetId = null;
    this.predicted = null;
    this.path = [];

    this.drawMap();
    this.drawPortals();
    this.drawNpcs();
    this.pathGraphics = this.add.graphics().setDepth(1);
    this.targetRing = this.add.graphics().setDepth(1_000_000);

    camera.fadeIn(280, 11, 13, 16);

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
      visual.update(delta, this.framePrefix);
      if (visual.isSelf) {
        focus = visual.current;
      }
    }
    for (const monster of this.monsterVisuals.values()) {
      monster.update(delta);
    }
    this.updateTargetRing();

    if (focus !== null) {
      this.cameras.main.centerOn(focus.x, focus.y + CAMERA_LIFT_PX);
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
        visual = new PlayerVisual(
          this,
          player.displayName,
          player.colorIndex,
          isSelf,
          this.framePrefix,
        );
        this.visuals.set(player.playerId, visual);
      }
      visual.setDisplayName(player.displayName);
      visual.setConnected(player.connected && player.alive);
      visual.setMotion(player.moving && player.alive, player.facing);

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

    const seenMonsters = new Set<string>();
    for (const monster of data.snapshot.monsters) {
      seenMonsters.add(monster.monsterId);
      let visual = this.monsterVisuals.get(monster.monsterId);
      if (visual === undefined) {
        visual = new MonsterVisual(this, monster.templateId, monster);
        this.monsterVisuals.set(monster.monsterId, visual);
      }
      visual.applyView(monster);
      visual.setTarget(this.projection.toScreen(monster.x, monster.y), false);
    }
    for (const [monsterId, visual] of this.monsterVisuals) {
      if (!seenMonsters.has(monsterId)) {
        visual.destroy();
        this.monsterVisuals.delete(monsterId);
        if (this.selectedTargetId === monsterId) {
          this.clearSelection();
        }
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

  monsterScreenPoint(monsterId: string): ScreenPoint | null {
    const visual = this.monsterVisuals.get(monsterId);
    if (visual === undefined) {
      return null;
    }
    const camera = this.cameras.main;
    const canvas = this.game.canvas.getBoundingClientRect();
    return {
      x: visual.current.x - camera.scrollX + canvas.left,
      y: visual.current.y - camera.scrollY + canvas.top,
    };
  }

  applyCombatEvent(event: CombatEvent): void {
    switch (event.kind) {
      case 'attack': {
        this.visualFor(event.sourceId)?.playAttack();
        if (event.skillId !== undefined) {
          this.showSkillEffect(event.sourceId, event.targetId);
        }
        break;
      }
      case 'hit': {
        const target = this.visualFor(event.targetId);
        target?.playHit();
        const position = this.entityPosition(event.targetId);
        if (position !== null) {
          this.floatText(
            position.x,
            position.y - 34,
            `${event.critical ? '暴击 ' : ''}-${String(event.damage)}`,
            event.critical ? '#ffb347' : '#ff7a6b',
            event.critical ? 20 : 16,
          );
        }
        if (event.targetType === 'player' && event.targetId === this.selfId) {
          this.cameras.main.shake(90, 0.0025);
        }
        break;
      }
      case 'miss': {
        const position = this.entityPosition(event.targetId);
        if (position !== null) {
          this.floatText(position.x, position.y - 34, '闪避', '#9a958a', 15);
        }
        break;
      }
      case 'heal': {
        const position = this.entityPosition(event.targetId);
        if (position !== null) {
          this.floatText(position.x, position.y - 34, `+${String(event.amount)}`, '#8fd08a', 17);
        }
        break;
      }
      case 'death': {
        this.visualFor(event.entityId)?.playDeath();
        break;
      }
      case 'spawn': {
        this.monsterVisuals.get(event.entityId)?.playSpawn();
        break;
      }
      case 'respawn': {
        const visual = this.visuals.get(event.entityId);
        visual?.playRespawn();
        this.floatText(
          this.projection.toScreen(event.x, event.y).x,
          this.projection.toScreen(event.x, event.y).y - 40,
          '复活',
          '#e5c15a',
          18,
        );
        break;
      }
    }
  }

  restart(): void {
    this.scene.restart();
  }

  private visualFor(entityId: string): PlayerVisual | MonsterVisual | undefined {
    return this.visuals.get(entityId) ?? this.monsterVisuals.get(entityId);
  }

  private entityPosition(entityId: string): ScreenPoint | null {
    const visual = this.visualFor(entityId);
    return visual === undefined ? null : visual.current;
  }

  private floatText(x: number, y: number, text: string, color: string, size: number): void {
    const label = this.add
      .text(x, y, text, {
        fontFamily: DISPLAY_FONT,
        fontSize: `${String(size)}px`,
        color,
        stroke: '#0b0d10',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(1_000_000);
    this.tweens.add({
      targets: label,
      y: y - 36,
      alpha: 0,
      duration: 850,
      ease: 'Quad.easeOut',
      onComplete: () => {
        label.destroy();
      },
    });
  }

  private showSkillEffect(sourceId: string, targetId: string): void {
    const from = this.entityPosition(sourceId);
    const to = this.entityPosition(targetId);
    if (from === null || to === null) {
      return;
    }
    const effect = this.add.graphics().setDepth(999_999);
    if (from.x === to.x && from.y === to.y) {
      effect.lineStyle(2, 0x8fd08a, 0.9);
      effect.strokeEllipse(to.x, to.y - 16, 46, 46);
    } else {
      effect.lineStyle(2, 0xffb347, 0.9);
      effect.lineBetween(from.x, from.y - 18, to.x, to.y - 18);
      effect.fillStyle(0xffb347, 0.9);
      effect.fillCircle(to.x, to.y - 18, 4);
    }
    this.tweens.add({
      targets: effect,
      alpha: 0,
      duration: 220,
      onComplete: () => {
        effect.destroy();
      },
    });
  }

  selectMonster(monsterId: string): void {
    if (this.selectedTargetId === monsterId) {
      return;
    }
    this.selectedTargetId = monsterId;
    this.bridge.notifyTarget(monsterId);
  }

  private clearSelection(): void {
    if (this.selectedTargetId === null) {
      return;
    }
    this.selectedTargetId = null;
    this.targetRing.clear();
    this.bridge.notifyTarget(null);
  }

  private updateTargetRing(): void {
    this.targetRing.clear();
    if (this.selectedTargetId === null) {
      return;
    }
    const visual = this.monsterVisuals.get(this.selectedTargetId);
    if (visual === undefined || !visual.isAlive) {
      return;
    }
    this.targetRing.lineStyle(2, 0xc9a227, 0.9);
    this.targetRing.strokeEllipse(visual.current.x, visual.current.y, 38, 18);
  }

  private monsterAt(worldX: number, worldY: number): string | null {
    let best: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [monsterId, visual] of this.monsterVisuals) {
      if (!visual.isAlive) {
        continue;
      }
      const distance = Math.hypot(
        worldX - visual.current.x,
        (worldY - (visual.current.y - 18)) * 1.3,
      );
      if (distance < 30 && distance < bestDistance) {
        best = monsterId;
        bestDistance = distance;
      }
    }
    return best;
  }

  private registerTilesetFrames(): void {
    const texture = this.textures.get('terrain');
    const { tileset } = this.bundle;
    for (let gid = 1; gid <= tileset.tileCount; gid += 1) {
      const name = `tile-${String(gid - 1)}`;
      if (texture.has(name)) {
        continue;
      }
      const column = (gid - 1) % tileset.columns;
      const row = Math.floor((gid - 1) / tileset.columns);
      texture.add(
        name,
        0,
        column * tileset.tileWidth,
        row * tileset.tileHeight,
        tileset.tileWidth,
        tileset.tileHeight,
      );
    }
  }

  private registerCharacterFrames(): void {
    const texture = this.textures.get('characters');
    const { player } = this.bundle;
    for (let direction = 0; direction < player.directions.length; direction += 1) {
      for (let frame = 0; frame < player.frames; frame += 1) {
        const name = `${this.framePrefix}d${String(direction)}f${String(frame)}`;
        if (!texture.has(name)) {
          texture.add(
            name,
            0,
            frame * player.frameWidth,
            direction * player.frameHeight,
            player.frameWidth,
            player.frameHeight,
          );
        }
      }
    }
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

  private drawMap(): void {
    const { manifest, tilesByGid } = this.bundle;
    const width = manifest.width;
    const { ground, decoLow, decoHigh, collision } = manifest.layers;

    // Static ground and low decoration are stamped once into a single
    // render texture. Under software WebGL, one texture instead of ~1,200
    // sprites keeps frame time low enough for the 250ms visibility gate.
    const staticLayer = this.add
      .renderTexture(0, 0, this.projection.mapWidth, this.projection.mapHeight)
      .setOrigin(0, 0)
      .setDepth(GROUND_DEPTH);

    for (let y = 0; y < manifest.height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const gid = ground[index] ?? 0;
        if (gid === 0) {
          continue;
        }
        const tile = tilesByGid.get(gid);
        if (tile === undefined) {
          continue;
        }
        const center = this.projection.tileCenter({ x, y });
        if (tile.name === 'wall' || (collision[index] === 1 && tile.name === 'tree')) {
          this.drawWall(center, tile.colors);
        } else {
          staticLayer.stamp('terrain', `tile-${String(gid - 1)}`, center.x, center.y);
        }
      }
    }

    for (let y = 0; y < manifest.height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const center = this.projection.tileCenter({ x, y });
        const lowGid = decoLow[index] ?? 0;
        if (lowGid > 0) {
          staticLayer.stamp('terrain', `tile-${String(lowGid - 1)}`, center.x, center.y);
        }
        const highGid = decoHigh[index] ?? 0;
        if (highGid > 0) {
          this.add
            .image(center.x, center.y, 'terrain', `tile-${String(highGid - 1)}`)
            .setDepth(center.y + TILE_HEIGHT / 2 + 2);
        }
      }
    }

    staticLayer.render();
  }

  private drawWall(center: ScreenPoint, colors: readonly [number, number]): void {
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
    const top = this.diamond(0, -WALL_HEIGHT);

    wall.fillStyle(colors[1], 1);
    wall.fillPoints(toVector2(leftFace), true);
    wall.fillStyle(colors[0], 1);
    wall.fillPoints(toVector2(rightFace), true);
    wall.fillStyle(0x4a5158, 1);
    wall.fillPoints(top, true);
    wall.lineStyle(1, 0x23272b, 1);
    wall.strokePoints(top, true);
  }

  private drawPortals(): void {
    for (const portal of this.bundle.manifest.portals) {
      const center = this.projection.tileCenter(portal.tile);
      const marker = this.add.graphics().setDepth(2);
      marker.lineStyle(2, 0x8fd0d0, 0.9);
      marker.strokeEllipse(center.x, center.y, TILE_WIDTH * 0.72, TILE_HEIGHT * 0.72);
      marker.fillStyle(0x8fd0d0, 0.18);
      marker.fillEllipse(center.x, center.y, TILE_WIDTH * 0.72, TILE_HEIGHT * 0.72);

      this.add
        .text(center.x, center.y - 34, portal.label, {
          fontFamily: DISPLAY_FONT,
          fontSize: '12px',
          color: '#b9e6e6',
          stroke: '#0b0d10',
          strokeThickness: 4,
        })
        .setOrigin(0.5, 1)
        .setDepth(center.y + TILE_HEIGHT);

      this.tweens.add({
        targets: marker,
        alpha: { from: 0.55, to: 1 },
        duration: 1_400,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  private drawNpcs(): void {
    for (const npc of this.bundle.manifest.npcPoints) {
      const center = this.projection.tileCenter(npc.tile);
      const marker = this.add.graphics().setDepth(center.y + 1);
      marker.fillStyle(0x2b2118, 0.5);
      marker.fillEllipse(center.x, center.y, 20, 9);
      marker.fillStyle(0xc9a227, 1);
      marker.fillTriangle(
        center.x,
        center.y - 26,
        center.x - 7,
        center.y - 10,
        center.x + 7,
        center.y - 10,
      );
      this.add
        .text(center.x, center.y - 30, npc.name, {
          fontFamily: DISPLAY_FONT,
          fontSize: '12px',
          color: '#e5c15a',
          stroke: '#0b0d10',
          strokeThickness: 4,
        })
        .setOrigin(0.5, 1)
        .setDepth(center.y + 2);
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

  private isTileWalkable(tile: TilePoint): boolean {
    const { manifest } = this.bundle;
    if (tile.x < 0 || tile.y < 0 || tile.x >= manifest.width || tile.y >= manifest.height) {
      return false;
    }
    return manifest.layers.collision[tile.y * manifest.width + tile.x] === 0;
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
    const monsterId = this.monsterAt(pointer.worldX, pointer.worldY);
    if (monsterId !== null) {
      this.selectMonster(monsterId);
      this.bridge.requestAttack(monsterId);
      return;
    }

    this.clearSelection();
    const tile = this.projection.toTile(pointer.worldX, pointer.worldY);
    if (!this.isTileWalkable(tile)) {
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
