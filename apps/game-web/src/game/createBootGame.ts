import Phaser from 'phaser';

import { BootScene } from './BootScene';

export function createBootGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0b0d10',
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: '100%',
      height: '100%',
    },
    render: {
      antialias: true,
      pixelArt: false,
    },
    audio: {
      noAudio: true,
    },
    scene: [BootScene],
  });
}
