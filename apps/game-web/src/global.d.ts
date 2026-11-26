import type { EquipmentSlot, InventorySnapshot, QuestView } from '@web-legend/contracts';

import type { PlayerAppearance, TelegraphView, WorldLabelView } from './game/worldBridge';
import type { LootView } from './net/worldClient';

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
      attackMonster: (monsterId: string) => boolean;
      attackPlayer: (playerId: string) => boolean;
      stopAutoAttack: () => boolean;
      startAutoAttack: () => boolean;
      castSkill: (skillId: string, targetId: string) => boolean;
      monsterScreenPoint: (monsterId: string) => { x: number; y: number } | null;
      playerScreenPoint: (playerId: string) => { x: number; y: number } | null;
      /** Which class sheet and clip the local player is rendering. */
      selfAppearance: () => PlayerAppearance;
      selfId: () => string;
      playerAppearance: (playerId: string) => PlayerAppearance | null;
      activeTelegraphs: () => TelegraphView[];
      npcScreenPoint: (npcId: string) => { x: number; y: number } | null;
      interactNpc: (npcId: string) => void;
      sendChat: (text: string) => boolean;
      pickupDrop: (dropId: string) => boolean;
      equipItem: (itemId: string) => boolean;
      unequipSlot: (slot: EquipmentSlot) => boolean;
      useItem: (itemId: string) => boolean;
      buyFromShop: (merchantId: string, templateId: string, quantity: number) => boolean;
      sellToShop: (merchantId: string, itemId: string, quantity: number) => boolean;
      acceptQuest: (questId: string) => boolean;
      claimQuest: (questId: string) => boolean;
      questState: () => QuestView[];
      lootDrops: () => LootView[];
      lootScreenPoint: (dropId: string) => { x: number; y: number } | null;
      lootIconFrame: (dropId: string) => number | null;
      labels: () => WorldLabelView[];
      inventoryState: () => InventorySnapshot | null;
      /** Diagnostics for the E2E visibility measurement. */
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
