export {};

declare global {
  interface Window {
    /** Exposed by the game client in development for Playwright automation. */
    __e2eClickAt?: number;
    __webLegendDebug?: {
      screenPointForTile: (tileX: number, tileY: number) => { x: number; y: number } | null;
      restartScene: () => boolean;
      sceneGeneration: () => number;
      dropConnection: () => boolean;
      leaveWorld: () => Promise<void>;
    };
  }
}
