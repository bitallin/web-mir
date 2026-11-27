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
      selfUnitPosition: () => { x: number; y: number } | null;
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
      inviteToParty: (playerId: string) => boolean;
      acceptPartyInvite: () => boolean;
      declinePartyInvite: () => boolean;
      leaveParty: () => boolean;
      partyState: () => {
        partyId: string;
        leaderId: string;
        maxMembers: number;
        members: {
          playerId: string;
          displayName: string;
          classId: string;
          level: number;
          hp: number;
          maxHp: number;
          alive: boolean;
          connected: boolean;
          leader: boolean;
        }[];
      } | null;
      partyInviteState: () => {
        inviteId: string;
        fromPlayerId: string;
        fromDisplayName: string;
        expiresAt: number;
        serverTime: number;
      } | null;
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
      lootIconFrame: (dropId: string) => number | null;
      labels: () => {
        id: string;
        kind: 'player' | 'monster' | 'npc';
        text: string;
        visible: boolean;
        rect: { x: number; y: number; width: number; height: number };
      }[];
      inventoryState: () => {
        characterId: string;
        gold: number;
        items: { itemId: string; templateId: string; name: string; quantity: number }[];
      } | null;
      acceptQuest: (questId: string) => boolean;
      acceptQuestAndHunt: (questId: string) => boolean;
      claimQuest: (questId: string) => boolean;
      navigateQuest: (questId: string, purpose: 'hunt' | 'return' | 'stop') => boolean;
      questState: () => {
        questId: string;
        status: 'locked' | 'available' | 'active' | 'completed' | 'claimed';
        progress: number;
      }[];
      questNavigationState: () => { questId: string; purpose: 'hunt' | 'return' } | null;
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
