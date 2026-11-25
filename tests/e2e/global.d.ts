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
      attackPlayer: (playerId: string) => boolean;
      stopAutoAttack: () => boolean;
      startAutoAttack: () => boolean;
      castSkill: (skillId: string, targetId: string) => boolean;
      monsterScreenPoint: (monsterId: string) => { x: number; y: number } | null;
      playerScreenPoint: (playerId: string) => { x: number; y: number } | null;
      sendChat: (text: string) => boolean;
      pickupDrop: (dropId: string) => boolean;
      equipItem: (itemId: string) => boolean;
      unequipSlot: (slot: 'weapon' | 'armor') => boolean;
      useItem: (itemId: string) => boolean;
      lootDrops: () => {
        dropId: string;
        itemId: string;
        templateId: string;
        displayName: string;
        quantity: number;
        x: number;
        y: number;
        ownerId: string;
        expiresAt: number;
      }[];
      lootScreenPoint: (dropId: string) => { x: number; y: number } | null;
      inventoryState: () => { characterId: string } | null;
      lastMoveIntentAt?: number;
      lastAckAt?: number;
      lastSnapshotAt?: number;
      lastMovingSnapshotAt?: number;
      lastAttackIntentAt?: number;
      lastCombatEventAt?: number;
      lastAssetResultAt?: number;
    };
  }
}
