import Phaser from 'phaser';

import { WorldScene } from './WorldScene';
import type { MapBundle } from './mapCatalog';
import type { WorldBridge } from './worldBridge';

export function createWorldGame(
  parent: HTMLElement,
  bridge: WorldBridge,
  bundle: MapBundle,
): Phaser.Game {
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
      // The technical art is pixel-sized and the development host renders with
      // SwiftShader; nearest sampling and no antialiasing keep frame time low
      // enough that socket callbacks are not delayed behind a slow frame.
      antialias: false,
      pixelArt: true,
      roundPixels: true,
    },
    audio: {
      noAudio: true,
    },
    scene: [new WorldScene(bridge, bundle)],
  });
}
