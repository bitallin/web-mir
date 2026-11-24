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
      currentMapId: () => string;
      /** Test-only input hook: submits the same intent a ground click sends. */
      moveToTile: (tileX: number, tileY: number) => boolean;
      /** Diagnostics for the E2E visibility measurement. */
      lastMoveIntentAt?: number;
      lastAckAt?: number;
      lastSnapshotAt?: number;
      lastMovingSnapshotAt?: number;
    };
  }
}
