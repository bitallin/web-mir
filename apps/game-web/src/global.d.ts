import type {
  EquipmentSlot,
  InventorySnapshot,
  FriendSnapshot,
  GuildApplicationView,
  GuildInviteView,
  GuildSummaryView,
  GuildView,
  PartyInviteView,
  PartyView,
  QuestNavigationPurpose,
  QuestView,
  TradeInviteView,
  TradeState,
} from '@web-legend/contracts';

import type {
  PlayerAppearance,
  ReachMarkerView,
  TelegraphView,
  WorldLabelView,
} from './game/worldBridge';
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
      /** Client-predicted position in 1000-unit tiles, sampled by movement E2E. */
      selfUnitPosition: () => { x: number; y: number } | null;
      /** Last authoritative snapshot position for the local player. */
      selfServerPosition: () => { x: number; y: number } | null;
      playerAppearance: (playerId: string) => PlayerAppearance | null;
      activeTelegraphs: () => TelegraphView[];
      /** Arrival markers currently drawn by the scene (TD-CLI-24). */
      questMarkers: () => ReachMarkerView[];
      questMarkerScreenPoint: (questId: string) => { x: number; y: number } | null;
      /** Alive party members currently ringed in the world (ADR-047). */
      partyMarkerIds: () => string[];
      npcScreenPoint: (npcId: string) => { x: number; y: number } | null;
      interactNpc: (npcId: string) => void;
      sendChat: (
        text: string,
        channel?: 'map' | 'party' | 'whisper',
        targetPlayerId?: string,
      ) => boolean;
      pickupDrop: (dropId: string) => boolean;
      equipItem: (itemId: string) => boolean;
      unequipSlot: (slot: EquipmentSlot) => boolean;
      useItem: (itemId: string) => boolean;
      buyFromShop: (merchantId: string, templateId: string, quantity: number) => boolean;
      sellToShop: (merchantId: string, itemId: string, quantity: number) => boolean;
      acceptQuest: (questId: string) => boolean;
      acceptQuestAndHunt: (questId: string) => boolean;
      claimQuest: (questId: string) => boolean;
      navigateQuest: (questId: string, purpose: QuestNavigationPurpose) => boolean;
      questState: () => QuestView[];
      questNavigationState: () => {
        questId: string;
        purpose: 'hunt' | 'return' | 'accept';
      } | null;
      inviteToParty: (playerId: string) => boolean;
      acceptPartyInvite: () => boolean;
      declinePartyInvite: () => boolean;
      leaveParty: () => boolean;
      partyState: () => PartyView | null;
      partyInviteState: () => PartyInviteView | null;
      transferPartyLeader: (playerId: string) => boolean;
      kickPartyMember: (playerId: string) => boolean;
      requestFriend: (playerId: string) => boolean;
      acceptFriendRequest: (requestId: string) => boolean;
      declineFriendRequest: (requestId: string) => boolean;
      removeFriend: (playerId: string) => boolean;
      refreshFriends: () => boolean;
      friendState: () => FriendSnapshot | null;
      guildState: () => GuildView | null;
      guildInviteState: () => GuildInviteView | null;
      guildDirectoryState: () => GuildSummaryView[] | null;
      guildApplicationsState: () => GuildApplicationView[];
      applyToGuild: (guildId: string) => boolean;
      acceptGuildApplication: (applicationId: string) => boolean;
      declineGuildApplication: (applicationId: string) => boolean;
      createGuild: (name: string) => boolean;
      inviteToGuild: (playerId: string) => boolean;
      acceptGuildInvite: () => boolean;
      declineGuildInvite: () => boolean;
      leaveGuild: () => boolean;
      kickGuildMember: (playerId: string) => boolean;
      disbandGuild: () => boolean;
      tradeState: () => TradeState | null;
      tradeInviteState: () => TradeInviteView | null;
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
