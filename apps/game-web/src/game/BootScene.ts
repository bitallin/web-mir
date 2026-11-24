import Phaser from 'phaser';

const INK = 0x0b0d10;
const GRID = 0x1b222a;
const GOLD_HEX = 0xc9a227;
const GOLD = '#c9a227';
const PARCHMENT = '#e8e0cd';
const MUTED = '#8b8677';
const DISPLAY_FONT = '"Noto Serif SC", "Songti SC", "SimSun", Georgia, serif';

/**
 * Technical boot screen. It proves the Phaser renderer, resize handling and
 * React overlay coexist; it deliberately contains no game art or game rules.
 */
export class BootScene extends Phaser.Scene {
  private graphics?: Phaser.GameObjects.Graphics;
  private title?: Phaser.GameObjects.Text;
  private subtitle?: Phaser.GameObjects.Text;
  private meta?: Phaser.GameObjects.Text;

  constructor() {
    super('boot');
  }

  create(): void {
    this.graphics = this.add.graphics();

    this.title = this.add
      .text(0, 0, 'WEB LEGEND', {
        fontFamily: DISPLAY_FONT,
        fontSize: '64px',
        color: PARCHMENT,
      })
      .setOrigin(0.5);

    this.subtitle = this.add
      .text(0, 0, '工程底座 · 阶段 0', {
        fontFamily: DISPLAY_FONT,
        fontSize: '18px',
        color: GOLD,
      })
      .setOrigin(0.5);

    this.meta = this.add
      .text(0, 0, 'Phaser 4.2  ·  React 19  ·  Colyseus 0.18', {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '12px',
        color: MUTED,
      })
      .setOrigin(0.5);

    this.draw();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleResize, this);
    });
  }

  private readonly handleResize = (): void => {
    this.draw();
  };

  private draw(): void {
    const { width, height } = this.scale;
    const graphics = this.graphics;
    if (graphics === undefined) {
      return;
    }

    graphics.clear();
    graphics.fillStyle(INK, 1);
    graphics.fillRect(0, 0, width, height);

    graphics.lineStyle(1, GRID, 1);
    const step = 64;
    for (let x = 0; x <= width; x += step) {
      graphics.lineBetween(x, 0, x, height);
    }
    for (let y = 0; y <= height; y += step) {
      graphics.lineBetween(0, y, width, y);
    }

    graphics.lineStyle(1, GOLD_HEX, 0.3);
    graphics.strokeRect(28, 28, Math.max(0, width - 56), Math.max(0, height - 56));

    const centerX = width / 2;
    const centerY = height / 2;

    graphics.lineStyle(1, GOLD_HEX, 0.9);
    graphics.lineBetween(centerX - 56, centerY + 48, centerX + 56, centerY + 48);

    const titleSize = Math.min(72, Math.max(32, Math.round(width / 16)));
    this.title?.setFontSize(titleSize).setPosition(centerX, centerY - 24);
    this.subtitle?.setPosition(centerX, centerY + 14);
    this.meta?.setPosition(centerX, centerY + 88);
  }
}
