import Phaser from 'phaser';

import type { LootView } from '../net/worldClient';
import type { ScreenPoint } from './projection';

const DISPLAY_FONT = '"Noto Serif SC", "Songti SC", "SimSun", Georgia, serif';

const LOOT_COLORS: Record<string, number> = {
  slime_gel: 0xb9a98a,
  wolf_pelt: 0xc2b49a,
  small_hp_potion: 0x9ac97f,
  small_mp_potion: 0x7fa7c9,
  warrior_sword: 0xd9a441,
  mage_staff: 0xd9a441,
  taoist_blade: 0xd9a441,
  cloth_armor: 0x6fa5c9,
  leather_armor: 0x6fa5c9,
};

/**
 * Ground drop marker. It is deliberately simple: a glowing pouch plus a label
 * carrying only data the server already published in the room state.
 */
export class LootVisual {
  readonly container: Phaser.GameObjects.Container;
  readonly current: ScreenPoint;

  constructor(scene: Phaser.Scene, view: LootView) {
    this.current = { x: 0, y: 0 };
    const color = LOOT_COLORS[view.templateId] ?? 0xc9b27a;

    const shadow = scene.add.graphics();
    shadow.fillStyle(0x000000, 0.35);
    shadow.fillEllipse(0, 0, 22, 8);

    const body = scene.add.graphics();
    body.fillStyle(0x14181d, 0.9);
    body.fillCircle(0, -10, 9);
    body.lineStyle(2, color, 0.95);
    body.strokeCircle(0, -10, 9);
    body.fillStyle(color, 0.9);
    body.fillCircle(0, -10, 3);

    const label = scene.add
      .text(0, -26, `${view.displayName}${view.quantity > 1 ? ` ×${String(view.quantity)}` : ''}`, {
        fontFamily: DISPLAY_FONT,
        fontSize: '11px',
        color: '#e8e0cd',
        stroke: '#0b0d10',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1);

    this.container = scene.add.container(0, 0, [shadow, body, label]);
    const pulse = scene.tweens.add({
      targets: body,
      alpha: { from: 0.7, to: 1 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.container.once(Phaser.GameObjects.Events.DESTROY, () => {
      pulse.stop();
    });
  }

  setPosition(screen: ScreenPoint): void {
    this.current.x = screen.x;
    this.current.y = screen.y;
    this.container.setPosition(screen.x, screen.y);
    this.container.setDepth(screen.y);
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
