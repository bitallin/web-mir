export {};

declare global {
  interface ImportMetaEnv {
    readonly VITE_GAME_SERVER_URL?: string;
  }

  interface Window {
    /** Development-only automation hooks used by the Playwright suite. */
    __webLegendDebug?: {
      screenPointForTile: (tileX: number, tileY: number) => { x: number; y: number } | null;
      restartScene: () => boolean;
      sceneGeneration: () => number;
      dropConnection: () => boolean;
      leaveWorld: () => Promise<void>;
    };
  }
}
