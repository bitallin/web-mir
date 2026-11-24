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
      currentMapId: () => string;
      moveToTile: (tileX: number, tileY: number) => boolean;
      attackMonster: (monsterId: string) => boolean;
      castSkill: (skillId: string, targetId: string) => boolean;
      monsterScreenPoint: (monsterId: string) => { x: number; y: number } | null;
      lastMoveIntentAt?: number;
      lastAckAt?: number;
      lastSnapshotAt?: number;
      lastMovingSnapshotAt?: number;
      lastAttackIntentAt?: number;
      lastCombatEventAt?: number;
    };
  }
}
