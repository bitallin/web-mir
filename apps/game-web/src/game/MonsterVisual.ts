import type Phaser from 'phaser';
import type { MonsterStateKind } from '@web-legend/contracts';

import type { MonsterView } from '../net/worldClient';
import type { LabelRect } from './labelLayout';
import type { ScreenPoint } from './projection';

const DISPLAY_FONT = '"Noto Serif SC", "Songti SC", "SimSun", Georgia, serif';
const HP_BAR_WIDTH = 44;
const HP_BAR_HEIGHT = 4;
const HP_BAR_OFFSET_Y = -60;
/** World bosses read as a different class of threat at a glance. */
const BOSS_SCALE = 1.45;

type MonsterPalette = {
  body: number;
  highlight: number;
  shadow: number;
};

const PALETTES: Record<string, MonsterPalette> = {
  wild_slime: { body: 0x4f7f4a, highlight: 0x7db06a, shadow: 0x22331f },
  forest_wolf: { body: 0x5a5f66, highlight: 0x7d838c, shadow: 0x272b30 },
  alpha_wolf: { body: 0xc9c4b6, highlight: 0xe8e3d5, shadow: 0x6d6a61 },
  venom_spider: { body: 0x4a3560, highlight: 0x7f5da3, shadow: 0x201528 },
  stone_guard: { body: 0x6b6f74, highlight: 0x9aa0a6, shadow: 0x33373b },
  skeleton_warrior: { body: 0xd8d2c2, highlight: 0xf0ead8, shadow: 0x6d6a5e },
  corrupt_warlock: { body: 0x3b2b55, highlight: 0x7a5aa6, shadow: 0x1a1226 },
  ruin_gargoyle: { body: 0x5f6469, highlight: 0x8d949b, shadow: 0x2c3034 },
  ashen_colossus: { body: 0x4a3b36, highlight: 0xd8722f, shadow: 0x1d1614 },
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
  private readonly aura: Phaser.GameObjects.Graphics;
  private initialized = false;
  private hp = 1;
  private maxHp = 1;
  private state: MonsterStateKind = 'idle';
  private level = 0;
  private displayName = '';
  private boss = false;
  private enraged = false;
  private readonly baseScale: number;

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
    this.aura = scene.add.graphics();
    this.aura.fillStyle(0xff5a1f, 0.14);
    this.aura.fillCircle(0, -22, 38);
    this.aura.fillStyle(0xff7a2f, 0.1);
    this.aura.fillCircle(0, -22, 46);
    this.aura.setVisible(false);

    const palette = PALETTES[templateId] ?? FALLBACK_PALETTE;
    this.drawBody(palette);

    this.container = scene.add.container(0, 0, [this.aura, this.body, this.nameText, this.hpBar]);
    this.boss = view.boss;
    this.baseScale = view.boss ? BOSS_SCALE : 1;
    this.container.setScale(this.baseScale);
    if (view.boss) {
      this.nameText.setColor('#f0c66b');
    }
    this.applyView(view);
  }

  get isAlive(): boolean {
    return this.state !== 'dead';
  }

  labelRect(): LabelRect {
    // The plate lives inside the scaled container, so its screen footprint is
    // the scaled text size and offset from the ground anchor.
    const width = this.nameText.width * this.baseScale;
    const height = this.nameText.height * this.baseScale;
    return {
      x: this.current.x - width / 2,
      y: this.current.y - 62 * this.baseScale - height,
      width,
      height,
    };
  }

  isBoss(): boolean {
    return this.boss;
  }

  labelText(): string {
    return this.nameText.text;
  }

  labelVisible(): boolean {
    return this.nameText.visible;
  }

  setLabelVisible(visible: boolean): void {
    this.nameText.setVisible(visible);
  }

  applyView(view: MonsterView): void {
    if (view.level !== this.level || view.displayName !== this.displayName) {
      this.level = view.level;
      this.displayName = view.displayName;
      this.nameText.setText(`Lv.${String(view.level)} ${view.displayName}`);
    }
    if (view.enraged !== this.enraged) {
      this.enraged = view.enraged;
      this.aura.setVisible(view.enraged);
      this.nameText.setColor(view.enraged ? '#ff8f5a' : this.boss ? '#f0c66b' : '#e8e0cd');
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
      scaleX: this.baseScale * 1.12,
      scaleY: this.baseScale * 0.92,
      duration: 70,
      yoyo: true,
    });
  }

  playHit(): void {
    this.scene.tweens.add({
      targets: this.container,
      scaleX: this.baseScale * 1.08,
      scaleY: this.baseScale * 0.94,
      duration: 60,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  playDeath(): void {
    this.state = 'dead';
    this.container.setAlpha(0.32);
    this.hpBar.setVisible(false);
    this.aura.setVisible(false);
  }

  playSpawn(): void {
    this.container.setAlpha(1);
    this.container.setScale(this.baseScale * 0.2);
    this.scene.tweens.add({
      targets: this.container,
      scaleX: this.baseScale,
      scaleY: this.baseScale,
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

    if (this.templateId === 'forest_wolf' || this.templateId === 'alpha_wolf') {
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

    if (this.templateId === 'venom_spider') {
      graphics.lineStyle(2, palette.shadow, 1);
      for (const side of [-1, 1]) {
        for (const offset of [6, 11, 16]) {
          graphics.lineBetween(side * 6, -16, side * offset, -2);
        }
      }
      graphics.fillStyle(palette.body, 1);
      graphics.fillEllipse(0, -18, 26, 20);
      graphics.fillStyle(palette.highlight, 1);
      graphics.fillEllipse(0, -22, 14, 10);
      graphics.fillStyle(0x1b1e22, 1);
      graphics.fillCircle(-4, -20, 1.8);
      graphics.fillCircle(4, -20, 1.8);
      return;
    }

    if (this.templateId === 'stone_guard') {
      graphics.fillStyle(palette.body, 1);
      graphics.fillRect(-17, -34, 34, 30);
      graphics.fillStyle(palette.highlight, 1);
      graphics.fillRect(-22, -26, 8, 18);
      graphics.fillRect(14, -26, 8, 18);
      graphics.fillStyle(palette.shadow, 1);
      graphics.fillRect(-17, -34, 34, 4);
      graphics.fillStyle(0x1b1e22, 1);
      graphics.fillRect(-8, -24, 5, 3);
      graphics.fillRect(3, -24, 5, 3);
      return;
    }

    if (this.templateId === 'skeleton_warrior') {
      // Bone-white silhouette with dark eye sockets and a rusted blade.
      graphics.fillStyle(palette.body, 1);
      graphics.fillCircle(0, -33, 8);
      graphics.fillRect(-6, -28, 12, 14);
      graphics.fillStyle(palette.shadow, 1);
      graphics.fillRect(-4, -27, 8, 2);
      graphics.fillRect(-4, -23, 8, 2);
      graphics.fillRect(-7, -14, 3, 12);
      graphics.fillRect(4, -14, 3, 12);
      graphics.fillStyle(0x1b1e22, 1);
      graphics.fillCircle(-3, -34, 1.7);
      graphics.fillCircle(3, -34, 1.7);
      graphics.fillStyle(0x8a7a5a, 1);
      graphics.fillRect(9, -34, 3, 22);
      graphics.fillStyle(palette.highlight, 1);
      graphics.fillRect(8, -36, 5, 3);
      return;
    }

    if (this.templateId === 'corrupt_warlock') {
      // Hooded caster with a floating corrupted crystal.
      graphics.fillStyle(palette.body, 1);
      graphics.fillTriangle(-14, -2, 0, -38, 14, -2);
      graphics.fillStyle(palette.highlight, 1);
      graphics.fillTriangle(-5, -26, 0, -36, 5, -26);
      graphics.fillCircle(0, -17, 6);
      graphics.fillStyle(0x1b1e22, 1);
      graphics.fillCircle(-3, -18, 1.5);
      graphics.fillCircle(3, -18, 1.5);
      graphics.fillStyle(0x9b6bd6, 1);
      graphics.fillCircle(13, -30, 4);
      graphics.fillStyle(0xd9b8ff, 1);
      graphics.fillCircle(12, -31, 1.5);
      graphics.fillStyle(palette.shadow, 1);
      graphics.fillRect(10, -26, 2, 14);
      return;
    }

    if (this.templateId === 'ruin_gargoyle') {
      // Squat stone body, spread wings and glowing eyes mark the elite.
      graphics.fillStyle(palette.shadow, 1);
      graphics.fillTriangle(-6, -22, -28, -38, -16, -10);
      graphics.fillTriangle(6, -22, 28, -38, 16, -10);
      graphics.fillStyle(palette.body, 1);
      graphics.fillRect(-15, -32, 30, 28);
      graphics.fillCircle(0, -34, 9);
      graphics.fillStyle(palette.highlight, 1);
      graphics.fillTriangle(-8, -42, -3, -48, 2, -42);
      graphics.fillTriangle(2, -42, 7, -48, 12, -42);
      graphics.fillStyle(0xd8a24a, 1);
      graphics.fillCircle(-4, -35, 2);
      graphics.fillCircle(4, -35, 2);
      graphics.fillStyle(palette.shadow, 1);
      graphics.fillRect(-15, -12, 30, 4);
      return;
    }

    if (this.templateId === 'ashen_colossus') {
      // Molten stone giant: heavy arms, cracked torso, ember eyes.
      graphics.fillStyle(palette.shadow, 1);
      graphics.fillRect(-30, -36, 11, 30);
      graphics.fillRect(19, -36, 11, 30);
      graphics.fillRect(-16, -44, 32, 42);
      graphics.fillStyle(palette.body, 1);
      graphics.fillRect(-14, -48, 28, 40);
      graphics.fillCircle(0, -52, 9);
      graphics.fillStyle(palette.highlight, 1);
      graphics.fillRect(-7, -46, 3, 18);
      graphics.fillRect(2, -42, 3, 24);
      graphics.fillRect(-10, -36, 20, 2);
      graphics.fillRect(-3, -31, 2, 12);
      graphics.fillCircle(-4, -53, 2.2);
      graphics.fillCircle(4, -53, 2.2);
      graphics.fillStyle(palette.shadow, 1);
      graphics.fillRect(-14, -12, 28, 5);
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
