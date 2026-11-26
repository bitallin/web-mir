import type Phaser from 'phaser';
import type { MonsterStateKind } from '@web-legend/contracts';

import type { MonsterView } from '../net/worldClient';
import type { ScreenPoint } from './projection';

const DISPLAY_FONT = '"Noto Serif SC", "Songti SC", "SimSun", Georgia, serif';
const HP_BAR_WIDTH = 44;
const HP_BAR_HEIGHT = 4;
const HP_BAR_OFFSET_Y = -60;

type MonsterPalette = {
  body: number;
  highlight: number;
  shadow: number;
};

const PALETTES: Record<string, MonsterPalette> = {
  wild_slime: { body: 0x4f7f4a, highlight: 0x7db06a, shadow: 0x22331f },
  forest_wolf: { body: 0x5a5f66, highlight: 0x7d838c, shadow: 0x272b30 },
};

const FALLBACK_PALETTE: MonsterPalette = { body: 0x6a5f86, highlight: 0x9a8fbf, shadow: 0x2a2536 };

function lerp(from: number, to: number, factor: number): number {
  return from + (to - from) * factor;
}

export class MonsterVisual {
  readonly container: Phaser.GameObjects.Container;
  current: ScreenPoint = { x: 0, y: 0 };
  target: ScreenPoint = { x: 0, y: 0 };
  private readonly nameText: Phaser.GameObjects.Text;
  private readonly hpBar: Phaser.GameObjects.Graphics;
  private readonly body: Phaser.GameObjects.Graphics;
  private initialized = false;
  private hp = 1;
  private maxHp = 1;
  private state: MonsterStateKind = 'idle';
  private level = 0;
  private displayName = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly templateId: string,
    view: MonsterView,
  ) {
    this.nameText = scene.add
      .text(0, -62, '', {
        fontFamily: DISPLAY_FONT,
        fontSize: '12px',
        color: '#e8e0cd',
        stroke: '#0b0d10',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1);
    this.hpBar = scene.add.graphics();
    this.body = scene.add.graphics();

    const palette = PALETTES[templateId] ?? FALLBACK_PALETTE;
    this.drawBody(palette);

    this.container = scene.add.container(0, 0, [this.body, this.nameText, this.hpBar]);
    this.applyView(view);
  }

  get isAlive(): boolean {
    return this.state !== 'dead';
  }

  applyView(view: MonsterView): void {
    if (view.level !== this.level || view.displayName !== this.displayName) {
      this.level = view.level;
      this.displayName = view.displayName;
      this.nameText.setText(`Lv.${String(view.level)} ${view.displayName}`);
    }
    this.setHp(view.hp, view.maxHp);
    this.setState(view.state);
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

  playAttack(_kind: 'attack' | 'cast' = 'attack'): void {
    this.scene.tweens.add({
      targets: this.container,
      scaleX: 1.12,
      scaleY: 0.92,
      duration: 70,
      yoyo: true,
    });
  }

  playHit(): void {
    this.scene.tweens.add({
      targets: this.container,
      scaleX: 1.08,
      scaleY: 0.94,
      duration: 60,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  playDeath(): void {
    this.state = 'dead';
    this.container.setAlpha(0.32);
    this.hpBar.setVisible(false);
  }

  playSpawn(): void {
    this.container.setAlpha(1);
    this.container.setScale(0.2);
    this.scene.tweens.add({
      targets: this.container,
      scaleX: 1,
      scaleY: 1,
      duration: 220,
      ease: 'Back.easeOut',
    });
    this.hpBar.setVisible(true);
  }

  destroy(): void {
    this.container.destroy(true);
  }

  private setHp(hp: number, maxHp: number): void {
    if (hp === this.hp && maxHp === this.maxHp) {
      return;
    }
    this.hp = hp;
    this.maxHp = maxHp;
    this.drawHpBar();
  }

  private setState(state: MonsterStateKind): void {
    if (state === this.state) {
      return;
    }
    this.state = state;
    if (state === 'dead') {
      this.playDeath();
      return;
    }
    this.container.setAlpha(1);
    this.hpBar.setVisible(true);
    this.drawHpBar();
  }

  private drawHpBar(): void {
    const graphics = this.hpBar;
    graphics.clear();
    const x = -HP_BAR_WIDTH / 2;
    const ratio = this.maxHp <= 0 ? 0 : Math.max(0, Math.min(1, this.hp / this.maxHp));
    graphics.fillStyle(0x0b0d10, 0.8);
    graphics.fillRect(x - 1, HP_BAR_OFFSET_Y - 1, HP_BAR_WIDTH + 2, HP_BAR_HEIGHT + 2);
    graphics.fillStyle(0x3a2320, 1);
    graphics.fillRect(x, HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT);
    if (ratio > 0) {
      graphics.fillStyle(0xb8544a, 1);
      graphics.fillRect(
        x,
        HP_BAR_OFFSET_Y,
        Math.max(1, Math.round(HP_BAR_WIDTH * ratio)),
        HP_BAR_HEIGHT,
      );
    }
  }

  private drawBody(palette: MonsterPalette): void {
    const graphics = this.body;
    graphics.fillStyle(0x000000, 0.35);
    graphics.fillEllipse(0, -2, 30, 10);

    if (this.templateId === 'forest_wolf') {
      graphics.fillStyle(palette.body, 1);
      graphics.fillEllipse(0, -16, 34, 18);
      graphics.fillEllipse(13, -24, 14, 12);
      graphics.fillStyle(palette.highlight, 1);
      graphics.fillTriangle(8, -30, 12, -38, 16, -30);
      graphics.fillTriangle(15, -30, 19, -37, 21, -28);
      graphics.fillStyle(0x1b1e22, 1);
      graphics.fillCircle(17, -25, 1.6);
      graphics.fillStyle(palette.shadow, 1);
      graphics.fillTriangle(-16, -18, -25, -26, -14, -12);
      return;
    }

    if (this.templateId === 'wild_slime') {
      graphics.fillStyle(palette.body, 1);
      graphics.fillEllipse(0, -14, 32, 22);
      graphics.fillStyle(palette.highlight, 1);
      graphics.fillEllipse(-5, -19, 12, 7);
      graphics.fillStyle(0x1b1e22, 1);
      graphics.fillCircle(-6, -15, 2);
      graphics.fillCircle(6, -15, 2);
      return;
    }

    graphics.fillStyle(palette.body, 1);
    graphics.fillEllipse(0, -16, 30, 20);
    graphics.fillStyle(palette.highlight, 1);
    graphics.fillEllipse(-5, -21, 10, 6);
    graphics.fillStyle(palette.shadow, 1);
    graphics.fillEllipse(0, -4, 22, 6);
  }
}
