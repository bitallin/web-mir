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
      selfAppearance: () => { textureKey: string; clip: string; frame: string };
      selfId: () => string;
      playerAppearance: (
        playerId: string,
      ) => { textureKey: string; clip: string; frame: string } | null;
      activeTelegraphs: () => {
        monsterId: string;
        x: number;
        y: number;
        radiusTiles: number;
        remainingMs: number;
      }[];
      npcScreenPoint: (npcId: string) => { x: number; y: number } | null;
      interactNpc: (npcId: string) => void;
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
      inventoryState: () => {
        characterId: string;
        gold: number;
        items: { itemId: string; templateId: string; name: string; quantity: number }[];
      } | null;
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
