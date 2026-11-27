import Phaser from 'phaser';
import {
  PLAYER_SPEED_UNITS_PER_SECOND,
  type CharacterAnimations,
  type CharacterClip,
  type CombatEvent,
  type CombatTargetChanged,
  type CommandAck,
  type TilePoint,
} from '@web-legend/contracts';

import type { PlayerView } from '../net/worldClient';
import { createProjection, TILE_HEIGHT, TILE_WIDTH, type ScreenPoint } from './projection';
import {
  assetManifest,
  ITEM_ICON_ATLAS_URL,
  ITEM_ICON_TEXTURE_KEY,
  type CharacterAsset,
  type MapBundle,
} from './mapCatalog';
import { resolveVisibleLabels, type LabelCandidate, type LabelRect } from './labelLayout';
import { LootVisual } from './LootVisual';
import { MonsterVisual } from './MonsterVisual';
import { buildPredictionWaypoints } from './movementPrediction';
import {
  FALLBACK_ANIMATIONS,
  animationFor,
  frameIndexFor,
  oneShotMs,
  resolveClip,
  type OneShot,
} from './playerAnimation';
import type {
  PlayerAppearance,
  SceneSnapshot,
  TelegraphView,
  WorldBridge,
  WorldLabelView,
  WorldSceneHandle,
} from './worldBridge';

const DISPLAY_FONT = '"Noto Serif SC", "Songti SC", "SimSun", Georgia, serif';
const WALL_HEIGHT = 24;
const MAX_FRAME_MS = 100;
const SNAP_DISTANCE_UNITS = 900;
const GROUND_DEPTH = -10_000;
/** Keeps the player and adjacent monsters above the bottom combat HUD. */
const CAMERA_LIFT_PX = 200;

const PLAYER_COLORS = [0x9fc4e0, 0xe0b087, 0xa8d6a1, 0xcf9fe0, 0xe0d18f, 0x8fd0d0];
const MIN_ONE_SHOT_MS = 180;
const LABEL_REFRESH_MS = 100;
const LABEL_PRIORITY = {
  self: 1000,
  target: 900,
  boss: 800,
  npc: 700,
  player: 500,
  monster: 400,
} as const;

type UnitPoint = { x: number; y: number };

type TelegraphVisual = {
  x: number;
  y: number;
  radiusTiles: number;
  expiresAt: number;
  container: Phaser.GameObjects.Container;
  timer: Phaser.Time.TimerEvent;
};

function lerp(from: number, to: number, factor: number): number {
  return from + (to - from) * factor;
}

function toVector2(points: readonly { x: number; y: number }[]): Phaser.Math.Vector2[] {
  return points.map((point) => new Phaser.Math.Vector2(point.x, point.y));
}

/** NPC labels are static texts with origin (0.5, 1), not children of a container. */
function npcLabelRect(label: Phaser.GameObjects.Text): LabelRect {
  return {
    x: label.x - label.width / 2,
    y: label.y - label.height,
    width: label.width,
    height: label.height,
  };
}

const PLAYER_HP_BAR_WIDTH = 40;
const PLAYER_HP_BAR_HEIGHT = 4;
const PLAYER_HP_BAR_OFFSET_Y = -44;

class PlayerVisual {
  readonly container: Phaser.GameObjects.Container;
  readonly nameText: Phaser.GameObjects.Text;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly isSelf: boolean;
  private readonly hpBar: Phaser.GameObjects.Graphics;
  private readonly character: CharacterAsset;
  private readonly animations: CharacterAnimations;
  current: ScreenPoint = { x: 0, y: 0 };
  target: ScreenPoint = { x: 0, y: 0 };
  private initialized = false;
  private elapsed = 0;
  private clipElapsed = 0;
  private clip: CharacterClip = 'idle';
  private oneShot: OneShot | null = null;
  private facing = 2;
  private moving = false;
  private displayName = '';
  private level = 1;
  private hp = 1;
  private maxHp = 1;
  private alive = true;

  constructor(
    scene: Phaser.Scene,
    displayName: string,
    colorIndex: number,
    isSelf: boolean,
    character: CharacterAsset,
  ) {
    this.isSelf = isSelf;
    this.character = character;
    this.animations = character.character.animations ?? FALLBACK_ANIMATIONS;
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length] ?? PLAYER_COLORS[0] ?? 0x9fc4e0;

    this.sprite = scene.add.sprite(0, 0, character.key, '2:0').setOrigin(0.5, 1);
    // Only the shared placeholder is tinted; class sheets carry their own palette.
    if (character.character.animations === undefined) {
      this.sprite.setTint(color);
    }

    this.nameText = scene.add
      .text(0, -58, displayName, {
        fontFamily: DISPLAY_FONT,
        fontSize: '13px',
        color: isSelf ? '#e5c15a' : '#e8e0cd',
        stroke: '#0b0d10',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1);

    this.hpBar = scene.add.graphics();

    this.container = scene.add.container(0, 0, [this.sprite, this.nameText, this.hpBar]);
    this.setDisplayName(displayName);
    this.drawHpBar();
  }

  get isAlive(): boolean {
    return this.alive;
  }

  applyView(player: PlayerView): void {
    this.setDisplayName(player.displayName);
    this.setLevel(player.level);
    this.setVitals(player.hp, player.maxHp, player.alive);
    this.container.setAlpha(player.connected && player.alive ? 1 : 0.4);
  }

  setDisplayName(displayName: string): void {
    if (this.displayName !== displayName) {
      this.displayName = displayName;
      this.redrawLabel();
    }
  }

  setLevel(level: number): void {
    if (this.level !== level) {
      this.level = level;
      this.redrawLabel();
    }
  }

  setVitals(hp: number, maxHp: number, alive: boolean): void {
    if (hp === this.hp && maxHp === this.maxHp && alive === this.alive) {
      return;
    }
    this.hp = hp;
    this.maxHp = maxHp;
    this.alive = alive;
    this.drawHpBar();
  }

  labelRect(): LabelRect {
    const width = this.nameText.width;
    const height = this.nameText.height;
    return { x: this.current.x - width / 2, y: this.current.y - 58 - height, width, height };
  }

  setLabelVisible(visible: boolean): void {
    this.nameText.setVisible(visible);
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

  update(deltaMs: number): void {
    const factor = 1 - Math.exp(-deltaMs / 70);
    this.current = {
      x: lerp(this.current.x, this.target.x, factor),
      y: lerp(this.current.y, this.target.y, factor),
    };
    this.container.setPosition(this.current.x, this.current.y);
    this.container.setDepth(this.current.y);

    this.elapsed += deltaMs;
    // `alive` is the authoritative snapshot state. A sticky local death flag
    // would never clear for onlookers, because respawn events are private.
    const clip = resolveClip(
      { alive: this.alive, moving: this.moving, oneShot: this.oneShot },
      this.elapsed,
    );
    if (clip === this.clip) {
      this.clipElapsed += deltaMs;
    } else {
      this.clip = clip;
      this.clipElapsed = 0;
    }
    const animation = animationFor(this.animations, clip);
    const frame = animation === undefined ? 0 : frameIndexFor(animation, this.clipElapsed);
    this.sprite.setFrame(`${String(this.facing)}:${String(frame)}`);
  }

  playAttack(kind: 'attack' | 'cast' = 'attack'): void {
    this.startOneShot(kind);
    this.container.scene.tweens.add({
      targets: this.container,
      scaleX: 1.12,
      scaleY: 0.92,
      duration: 70,
      yoyo: true,
    });
  }

  playHit(): void {
    this.startOneShot('hurt');
    this.container.scene.tweens.add({
      targets: this.container,
      alpha: 0.45,
      duration: 70,
      yoyo: true,
    });
  }

  playDeath(): void {
    this.oneShot = null;
    this.container.setAlpha(0.28);
    this.hpBar.setVisible(false);
  }

  playRespawn(): void {
    this.oneShot = null;
    this.container.setAlpha(1);
    this.hpBar.setVisible(true);
    this.container.scene.tweens.add({
      targets: this.container,
      alpha: { from: 0.2, to: 1 },
      duration: 260,
    });
  }

  appearance(): PlayerAppearance {
    return {
      textureKey: this.character.key,
      clip: this.clip,
      frame: this.sprite.frame.name,
    };
  }

  private startOneShot(clip: CharacterClip): void {
    if (!this.alive) {
      return;
    }
    const duration = Math.max(oneShotMs(this.animations, clip), MIN_ONE_SHOT_MS);
    this.oneShot = { clip, endMs: this.elapsed + duration };
  }

  destroy(): void {
    this.container.destroy(true);
  }

  private redrawLabel(): void {
    this.nameText.setText(`Lv.${String(this.level)} ${this.displayName}`);
  }

  private drawHpBar(): void {
    const ratio = this.maxHp <= 0 ? 0 : Math.max(0, Math.min(1, this.hp / this.maxHp));
    const x = -PLAYER_HP_BAR_WIDTH / 2;
    this.hpBar.clear();
    this.hpBar.setVisible(this.alive);
    this.hpBar.fillStyle(0x0b0d10, 0.8);
    this.hpBar.fillRect(
      x - 1,
      PLAYER_HP_BAR_OFFSET_Y - 1,
      PLAYER_HP_BAR_WIDTH + 2,
      PLAYER_HP_BAR_HEIGHT + 2,
    );
    this.hpBar.fillStyle(0x3a2320, 1);
    this.hpBar.fillRect(x, PLAYER_HP_BAR_OFFSET_Y, PLAYER_HP_BAR_WIDTH, PLAYER_HP_BAR_HEIGHT);
    if (ratio > 0) {
      this.hpBar.fillStyle(this.isSelf ? 0x7fa66a : 0xb8544a, 1);
      this.hpBar.fillRect(
        x,
        PLAYER_HP_BAR_OFFSET_Y,
        Math.max(1, Math.round(PLAYER_HP_BAR_WIDTH * ratio)),
        PLAYER_HP_BAR_HEIGHT,
      );
    }
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
  private readonly lootVisuals = new Map<string, LootVisual>();
  private readonly telegraphs = new Map<string, TelegraphVisual>();
  private readonly npcLabels = new Map<string, Phaser.GameObjects.Text>();
  private labelClock = 0;
  private pathGraphics!: Phaser.GameObjects.Graphics;
  private targetRing!: Phaser.GameObjects.Graphics;
  private selfId: string | null = null;
  private selectedTargetId: string | null = null;
  private predicted: UnitPoint | null = null;
  private path: UnitPoint[] = [];
  private speed: number = PLAYER_SPEED_UNITS_PER_SECOND;

  constructor(bridge: WorldBridge, bundle: MapBundle) {
    super('world');
    this.bridge = bridge;
    this.bundle = bundle;
    this.projection = createProjection(bundle.manifest);
  }

  preload(): void {
    this.load.image('terrain', this.bundle.terrainImageUrl);
    for (const character of [this.bundle.fallbackCharacter, ...this.bundle.characters.values()]) {
      this.load.image(character.key, character.imageUrl);
    }
    const icons = assetManifest.itemIcons;
    this.load.spritesheet(ITEM_ICON_TEXTURE_KEY, ITEM_ICON_ATLAS_URL, {
      frameWidth: icons.size,
      frameHeight: icons.size,
    });
  }

  create(): void {
    this.registerTilesetFrames();
    this.registerCharacterFrames(this.bundle.fallbackCharacter);
    for (const character of this.bundle.characters.values()) {
      this.registerCharacterFrames(character);
    }

    const camera = this.cameras.main;
    camera.setBackgroundColor('#0b0d10');
    camera.setBounds(0, 0, this.projection.mapWidth, this.projection.mapHeight);
    camera.centerOn(this.projection.mapWidth / 2, this.projection.mapHeight / 2);

    this.visuals.clear();
    this.monsterVisuals.clear();
    this.lootVisuals.clear();
    this.telegraphs.clear();
    this.npcLabels.clear();
    this.labelClock = 0;
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
      visual.update(delta);
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

    this.labelClock += delta;
    if (this.labelClock >= LABEL_REFRESH_MS) {
      this.labelClock = 0;
      this.updateLabelVisibility();
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
          this.characterFor(player.classId),
        );
        this.visuals.set(player.playerId, visual);
      }
      visual.applyView(player);
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
        if (this.selectedTargetId === playerId) {
          this.clearSelection();
        }
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

    const seenLoot = new Set<string>();
    for (const drop of data.snapshot.loot) {
      seenLoot.add(drop.dropId);
      let visual = this.lootVisuals.get(drop.dropId);
      if (visual === undefined) {
        visual = new LootVisual(this, drop);
        this.lootVisuals.set(drop.dropId, visual);
      }
      visual.setPosition(this.projection.toScreen(drop.x, drop.y));
    }
    for (const [dropId, visual] of this.lootVisuals) {
      if (!seenLoot.has(dropId)) {
        visual.destroy();
        this.lootVisuals.delete(dropId);
      }
    }
  }

  applyAck(ack: CommandAck): void {
    this.speed = ack.speedUnitsPerSecond;
    if (this.predicted === null) {
      this.predicted = { x: ack.startX, y: ack.startY };
    }
    this.path = buildPredictionWaypoints(this.predicted, ack.path);
    this.drawPath(ack.path);
  }

  /**
   * Auto-attack approach paths arrive on `combat.target.changed`. Without them
   * the client had no prediction for a chase and only followed 10Hz snapshots,
   * which read as stepwise movement; applying the authoritative path restores
   * the same smooth prediction as a manual click.
   */
  applyAutoAttackState(state: CombatTargetChanged): void {
    if (state.reason === 'approaching' && state.path !== undefined) {
      this.speed = state.speedUnitsPerSecond ?? this.speed;
      if (this.predicted === null) {
        this.predicted = { x: state.startX ?? 0, y: state.startY ?? 0 };
      }
      this.path = buildPredictionWaypoints(this.predicted, state.path);
      this.drawPath(state.path);
      return;
    }
    // Once in range the server stops the approach; the client must stop
    // predicting a path that would carry it past the target. On 'engaged' the
    // next tick replaces a manual path with the approach path, so keeping the
    // old path briefly avoids a frame of snapshot lerp pulling backwards.
    if (state.reason === 'attacking' || !state.autoAttack) {
      this.path = [];
      this.pathGraphics.clear();
    }
  }

  /** Client-predicted position in unit coordinates; E2E samples smoothness. */
  selfUnitPosition(): { x: number; y: number } | null {
    return this.predicted === null ? null : { x: this.predicted.x, y: this.predicted.y };
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

  playerScreenPoint(playerId: string): ScreenPoint | null {
    const visual = this.visuals.get(playerId);
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

  npcScreenPoint(npcId: string): ScreenPoint | null {
    const npc = this.bundle.manifest.npcPoints.find((point) => point.id === npcId);
    if (npc === undefined) {
      return null;
    }
    const center = this.projection.tileCenter(npc.tile);
    const camera = this.cameras.main;
    const canvas = this.game.canvas.getBoundingClientRect();
    return {
      x: center.x - camera.scrollX + canvas.left,
      y: center.y - camera.scrollY + canvas.top,
    };
  }

  applyCombatEvent(event: CombatEvent): void {
    switch (event.kind) {
      case 'attack': {
        this.visualFor(event.sourceId)?.playAttack(event.skillId === undefined ? 'attack' : 'cast');
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
          const hpDamage = Math.max(0, event.damage - (event.absorbed ?? 0));
          if (hpDamage > 0) {
            this.floatText(
              position.x,
              position.y - 34,
              `${event.critical ? '暴击 ' : ''}-${String(hpDamage)}`,
              event.periodic === true ? '#b48cf2' : event.critical ? '#ffb347' : '#ff7a6b',
              event.critical ? 20 : 16,
            );
          }
          if (event.absorbed !== undefined && event.absorbed > 0) {
            this.floatText(
              position.x + 16,
              position.y - 50,
              `护盾 -${String(event.absorbed)}`,
              '#7fb7ff',
              14,
            );
          }
        }
        if (event.targetType === 'player' && event.targetId === this.selfId) {
          this.cameras.main.shake(90, 0.0025);
        }
        break;
      }
      case 'shield': {
        const position = this.entityPosition(event.targetId);
        if (position !== null) {
          this.floatText(
            position.x,
            position.y - 44,
            event.amount > 0 ? `护盾 +${String(event.amount)}` : '护盾消散',
            '#7fb7ff',
            15,
          );
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
      case 'telegraph': {
        this.showTelegraph(event);
        break;
      }
      case 'death': {
        this.visualFor(event.entityId)?.playDeath();
        this.cancelTelegraph(event.entityId);
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

  /**
   * The server has committed a monster attack to this point. The ring and the
   * filling ellipse show where and when it lands; only the server decides
   * whether the player is still inside.
   */
  private showTelegraph(event: Extract<CombatEvent, { kind: 'telegraph' }>): void {
    this.cancelTelegraph(event.sourceId);
    const center = this.projection.toScreen(event.x, event.y);
    const width = event.radiusTiles * TILE_WIDTH;
    const height = event.radiusTiles * TILE_HEIGHT;

    const ring = this.add.graphics();
    ring.fillStyle(0xd8452f, 0.18);
    ring.fillEllipse(0, 0, width, height);
    ring.lineStyle(2, 0xff7a5c, 0.9);
    ring.strokeEllipse(0, 0, width, height);

    const fill = this.add.graphics();
    fill.fillStyle(0xff6b4a, 0.32);
    fill.fillEllipse(0, 0, width, height);
    fill.setScale(0.15);

    const container = this.add.container(center.x, center.y, [ring, fill]);
    container.setDepth(center.y - 1);
    this.tweens.add({
      targets: fill,
      scaleX: 1,
      scaleY: 1,
      duration: event.impactInMs,
      ease: 'Linear',
    });

    const sourceId = event.sourceId;
    const timer = this.time.delayedCall(event.impactInMs + 120, () => {
      this.cancelTelegraph(sourceId);
    });
    this.telegraphs.set(sourceId, {
      x: event.x,
      y: event.y,
      radiusTiles: event.radiusTiles,
      expiresAt: this.time.now + event.impactInMs,
      container,
      timer,
    });
  }

  private cancelTelegraph(sourceId: string): void {
    const telegraph = this.telegraphs.get(sourceId);
    if (telegraph === undefined) {
      return;
    }
    telegraph.timer.remove(false);
    telegraph.container.destroy(true);
    this.telegraphs.delete(sourceId);
  }

  /** Test-only readback so E2E can prove the warning is rendered. */
  activeTelegraphs(): TelegraphView[] {
    const now = this.time.now;
    return [...this.telegraphs.entries()]
      .filter(([, telegraph]) => telegraph.expiresAt > now)
      .map(([monsterId, telegraph]) => ({
        monsterId,
        x: telegraph.x,
        y: telegraph.y,
        radiusTiles: telegraph.radiusTiles,
        remainingMs: Math.max(0, telegraph.expiresAt - now),
      }));
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

  selectEntity(entityId: string): void {
    if (this.selectedTargetId === entityId) {
      return;
    }
    this.selectedTargetId = entityId;
    this.labelClock = LABEL_REFRESH_MS;
    this.bridge.notifyTarget(entityId);
  }

  private clearSelection(): void {
    if (this.selectedTargetId === null) {
      return;
    }
    this.selectedTargetId = null;
    this.targetRing.clear();
    this.labelClock = LABEL_REFRESH_MS;
    this.bridge.notifyTarget(null);
  }

  /**
   * Keeps one name plate per screen spot: self and the locked target win, then
   * NPCs, then other players and monsters. Positions never move, so walking
   * past another entity cannot make a label jump between two offsets.
   */
  private updateLabelVisibility(): void {
    const selfId = this.selfId;
    const focus = selfId === null ? null : (this.visuals.get(selfId)?.current ?? null);
    const distanceTo = (x: number, y: number): number =>
      focus === null ? 0 : Math.hypot(x - focus.x, y - focus.y);
    const candidates: LabelCandidate[] = [];

    for (const [playerId, visual] of this.visuals) {
      if (!visual.isAlive) {
        visual.setLabelVisible(false);
        continue;
      }
      const priority = visual.isSelf
        ? LABEL_PRIORITY.self
        : playerId === this.selectedTargetId
          ? LABEL_PRIORITY.target
          : LABEL_PRIORITY.player;
      candidates.push({
        id: `player:${playerId}`,
        priority,
        distance: distanceTo(visual.current.x, visual.current.y),
        rect: visual.labelRect(),
      });
    }

    for (const [monsterId, visual] of this.monsterVisuals) {
      if (!visual.isAlive) {
        visual.setLabelVisible(false);
        continue;
      }
      const priority =
        monsterId === this.selectedTargetId
          ? LABEL_PRIORITY.target
          : visual.isBoss()
            ? LABEL_PRIORITY.boss
            : LABEL_PRIORITY.monster;
      candidates.push({
        id: `monster:${monsterId}`,
        priority,
        distance: distanceTo(visual.current.x, visual.current.y),
        rect: visual.labelRect(),
      });
    }

    for (const [npcId, label] of this.npcLabels) {
      candidates.push({
        id: `npc:${npcId}`,
        priority: LABEL_PRIORITY.npc,
        distance: distanceTo(label.x, label.y - label.height / 2),
        rect: npcLabelRect(label),
      });
    }

    const visible = resolveVisibleLabels(candidates);
    for (const [playerId, visual] of this.visuals) {
      visual.setLabelVisible(visible.has(`player:${playerId}`));
    }
    for (const [monsterId, visual] of this.monsterVisuals) {
      visual.setLabelVisible(visible.has(`monster:${monsterId}`));
    }
    for (const [npcId, label] of this.npcLabels) {
      label.setVisible(visible.has(`npc:${npcId}`));
    }
  }

  /** Test-only readback: every world name plate with its final visibility. */
  labels(): WorldLabelView[] {
    const out: WorldLabelView[] = [];
    for (const [playerId, visual] of this.visuals) {
      out.push({
        id: `player:${playerId}`,
        kind: 'player',
        text: visual.nameText.text,
        visible: visual.nameText.visible,
        rect: visual.labelRect(),
      });
    }
    for (const [monsterId, visual] of this.monsterVisuals) {
      out.push({
        id: `monster:${monsterId}`,
        kind: 'monster',
        text: visual.labelText(),
        visible: visual.labelVisible(),
        rect: visual.labelRect(),
      });
    }
    for (const [npcId, label] of this.npcLabels) {
      out.push({
        id: `npc:${npcId}`,
        kind: 'npc',
        text: label.text,
        visible: label.visible,
        rect: npcLabelRect(label),
      });
    }
    return out;
  }

  lootIconFrame(dropId: string): number | null {
    return this.lootVisuals.get(dropId)?.frame ?? null;
  }

  private updateTargetRing(): void {
    this.targetRing.clear();
    if (this.selectedTargetId === null) {
      return;
    }
    const monster = this.monsterVisuals.get(this.selectedTargetId);
    const player = this.visuals.get(this.selectedTargetId);
    const visual = monster ?? player;
    if (visual === undefined || ('isAlive' in visual && !visual.isAlive)) {
      return;
    }
    this.targetRing.lineStyle(2, 0xc9a227, 0.9);
    this.targetRing.strokeEllipse(visual.current.x, visual.current.y, 38, 18);
  }

  lootScreenPoint(dropId: string): ScreenPoint | null {
    const visual = this.lootVisuals.get(dropId);
    if (visual === undefined) {
      return null;
    }
    const camera = this.cameras.main;
    return {
      x: visual.current.x - camera.scrollX,
      y: visual.current.y - camera.scrollY - 10,
    };
  }

  private lootAt(worldX: number, worldY: number): string | null {
    let best: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [dropId, visual] of this.lootVisuals) {
      const distance = Math.hypot(
        worldX - visual.current.x,
        (worldY - (visual.current.y - 10)) * 1.2,
      );
      if (distance < 24 && distance < bestDistance) {
        best = dropId;
        bestDistance = distance;
      }
    }
    return best;
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

  private playerAt(worldX: number, worldY: number): string | null {
    let best: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [playerId, visual] of this.visuals) {
      if (!visual.isAlive || playerId === this.selfId) {
        continue;
      }
      const distance = Math.hypot(
        worldX - visual.current.x,
        (worldY - (visual.current.y - 24)) * 1.25,
      );
      if (distance < 26 && distance < bestDistance) {
        best = playerId;
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

  private characterFor(classId: string): CharacterAsset {
    return this.bundle.characters.get(classId) ?? this.bundle.fallbackCharacter;
  }

  playerAppearance(playerId: string): PlayerAppearance | null {
    return this.visuals.get(playerId)?.appearance() ?? null;
  }

  private registerCharacterFrames(asset: CharacterAsset): void {
    const texture = this.textures.get(asset.key);
    const { character } = asset;
    for (let direction = 0; direction < character.directions.length; direction += 1) {
      for (let frame = 0; frame < character.frames; frame += 1) {
        const name = `${String(direction)}:${String(frame)}`;
        if (!texture.has(name)) {
          texture.add(
            name,
            0,
            frame * character.frameWidth,
            direction * character.frameHeight,
            character.frameWidth,
            character.frameHeight,
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
      const label = this.add
        .text(center.x, center.y - 30, npc.name, {
          fontFamily: DISPLAY_FONT,
          fontSize: '12px',
          color: '#e5c15a',
          stroke: '#0b0d10',
          strokeThickness: 4,
        })
        .setOrigin(0.5, 1)
        .setDepth(center.y + 2);
      this.npcLabels.set(npc.id, label);
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

  private npcAt(worldX: number, worldY: number): string | null {
    for (const npc of this.bundle.manifest.npcPoints) {
      const center = this.projection.tileCenter(npc.tile);
      const dx = worldX - center.x;
      const dy = worldY - (center.y - 16);
      if (dx * dx + dy * dy <= 30 * 30) {
        return npc.id;
      }
    }
    return null;
  }

  private readonly handlePointerDown = (pointer: Phaser.Input.Pointer): void => {
    // A living monster wins over a drop that lies underneath it; the loot list
    // in the HUD can always claim the drop without a precise click.
    const monsterId = this.monsterAt(pointer.worldX, pointer.worldY);
    if (monsterId !== null) {
      this.selectEntity(monsterId);
      this.bridge.requestAttack(monsterId);
      return;
    }

    const playerId = this.playerAt(pointer.worldX, pointer.worldY);
    if (playerId !== null) {
      this.selectEntity(playerId);
      this.bridge.requestAttack(playerId);
      return;
    }

    const dropId = this.lootAt(pointer.worldX, pointer.worldY);
    if (dropId !== null) {
      this.bridge.requestPickup(dropId);
      return;
    }

    const npcId = this.npcAt(pointer.worldX, pointer.worldY);
    if (npcId !== null) {
      this.bridge.requestNpcInteraction(npcId);
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
