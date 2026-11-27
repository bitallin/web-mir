import { QUEST_NPC_RANGE_TILES, SHOP_RANGE_TILES, TILE_UNITS } from '@web-legend/contracts';
import type {
  CharacterView,
  CharacterProgress,
  ChatChannel,
  ChatMessage,
  CombatEvent,
  CombatProfile,
  CombatTargetChanged,
  EquipmentSlot,
  InventorySnapshot,
  LevelUp,
  LootClaimed,
  PartyInviteView,
  PartyView,
  QuestNavigation,
  QuestNavigationPurpose,
  QuestNavigationReason,
  QuestView,
  SessionKicked,
  ShopCatalog,
  SystemNotice,
  TilePoint,
} from '@web-legend/contracts';
import type Phaser from 'phaser';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { createWorldGame } from '../game/createWorldGame';
import { mapBundleFor } from '../game/mapCatalog';
import { isSfxMuted, SfxPlayer } from '../game/sfx';
import { WorldBridge } from '../game/worldBridge';
import { loadFreshTransfers, loadRoomPreference } from '../lib/identity';
import { questObjectiveProgressLabel } from '../lib/questPanel';
import { lootIsLocked, lootLockLabel, lootTile, withinPickupRange } from '../lib/lootInteraction';
import {
  WorldClient,
  type ConnectionStatus,
  type LootView,
  type MonsterView,
  type PlayerView,
  type WorldSnapshot,
} from '../net/worldClient';

export type SessionNotice = {
  id: string;
  kind: 'info' | 'warning' | 'error';
  message: string;
  at: number;
};

export type CombatLogEntry = {
  id: string;
  text: string;
  tone: 'self' | 'other' | 'system';
  at: number;
};

export type SystemMessageEntry = {
  id: string;
  kind: SystemNotice['kind'];
  message: string;
  at: number;
};

export type SessionState = {
  status: ConnectionStatus;
  detail: string;
  mapId: string;
  instanceId: string;
  players: PlayerView[];
  monsters: MonsterView[];
  loot: LootView[];
  selfId: string;
  latencyMs: number | null;
  commandCount: number;
  serverTick: number;
  roomId: string | null;
  roomPlayerCount: number;
  messages: ChatMessage[];
  systemMessages: SystemMessageEntry[];
  combatProfile: CombatProfile | null;
  combatLog: CombatLogEntry[];
  selectedTargetId: string | null;
  skillCooldowns: Record<string, number>;
  /** Remaining absorb points of the local player's shield, if any. */
  shield: { amount: number } | null;
  inventory: InventorySnapshot | null;
  shopCatalog: ShopCatalog | null;
  /** A nearby NPC click; GameScreen turns it into the merchant panel. */
  shopRequest: { npcId: string; seq: number } | null;
  /** Quest state delivered by the server, already resolved for display. */
  quests: QuestView[];
  /** Server-owned one-click quest guidance, if any (ADR-039). */
  questNavigation: QuestNavigation | null;
  /** A nearby quest-giver click; GameScreen opens the quest panel. */
  questRequest: { npcId: string; seq: number } | null;
  /** Server-owned party roster; null when the player is not in a party. */
  party: PartyView | null;
  /** An unanswered party invitation addressed to the local player. */
  partyInvite: PartyInviteView | null;
  levelUpNotice: LevelUp | null;
  /** Transient toasts; each removes itself after a few seconds (TD-CLI-02). */
  notices: SessionNotice[];
  /** Server-owned auto-attack status for the locked target. */
  autoAttack: CombatTargetChanged | null;
  /** Client clock deadline for the local player's automatic revival. */
  reviveAt: number | null;
  kicked: SessionKicked | null;
  sfxMuted: boolean;
  /** True for a short moment after the local player's loot enters the bag. */
  bagPulse: boolean;
};

export type WorldSessionOptions = {
  character: CharacterView;
  requestTicket: () => Promise<string>;
};

const MAX_CHAT_MESSAGES = 120;
const MAX_SYSTEM_MESSAGES = 60;
const MAX_COMBAT_LOG = 12;
/** Give up a far-loot approach after this long without reaching the drop. */
const LOOT_APPROACH_TIMEOUT_MS = 15_000;

function questNavigationStopMessage(reason: QuestNavigationReason): string {
  switch (reason) {
    case 'player_dead':
      return '角色倒下，自动流程已停止';
    case 'no_route':
      return '找不到前往目标的路，自动流程已停止';
    case 'out_of_range':
      return '目标超出范围，自动流程已停止';
    case 'target_gone':
      return '目标已消失，自动流程已停止';
    case 'quest_changed':
      return '任务状态已变化，自动流程已停止';
    case 'manual':
      return '自动流程已停止';
  }
}

function initialState(character: CharacterView): SessionState {
  return {
    status: 'connecting',
    detail: '正在准备世界',
    mapId: character.mapId,
    instanceId: '1',
    players: [],
    monsters: [],
    loot: [],
    selfId: character.id,
    latencyMs: null,
    commandCount: 0,
    serverTick: 0,
    roomId: null,
    roomPlayerCount: 0,
    messages: [],
    systemMessages: [],
    combatProfile: null,
    combatLog: [],
    selectedTargetId: null,
    skillCooldowns: {},
    shield: null,
    inventory: null,
    shopCatalog: null,
    shopRequest: null,
    quests: [],
    questNavigation: null,
    questRequest: null,
    party: null,
    partyInvite: null,
    levelUpNotice: null,
    notices: [],
    autoAttack: null,
    reviveAt: null,
    kicked: null,
    sfxMuted: isSfxMuted(),
    bagPulse: false,
  };
}

function withProgress(
  snapshot: InventorySnapshot | null,
  progress: CharacterProgress,
): InventorySnapshot | null {
  if (snapshot === null) {
    return null;
  }
  return {
    ...snapshot,
    level: progress.level,
    exp: progress.exp,
    expToNextLevel: progress.expToNextLevel,
    gold: progress.gold,
    hp: progress.hp,
    maxHp: progress.maxHp,
    mp: progress.mp,
    maxMp: progress.maxMp,
    attack: progress.attack,
    defense: progress.defense,
  };
}

function lootLogEntry(claimed: LootClaimed, characterId: string): CombatLogEntry {
  return {
    id: `loot-${claimed.dropId}`,
    text: `${claimed.claimerName} 拾取了 ${claimed.name} ×${String(claimed.quantity)}`,
    tone: claimed.claimerId === characterId ? 'self' : 'other',
    at: Date.now(),
  };
}

function entityName(state: Pick<SessionState, 'players' | 'monsters'>, entityId: string): string {
  const player = state.players.find((candidate) => candidate.playerId === entityId);
  if (player !== undefined) {
    return player.displayName;
  }
  const monster = state.monsters.find((candidate) => candidate.monsterId === entityId);
  return monster?.displayName ?? '目标';
}

function combatLogFor(
  state: SessionState,
  event: CombatEvent,
  characterId: string,
): CombatLogEntry | null {
  const tone = (id: string): CombatLogEntry['tone'] => (id === characterId ? 'self' : 'other');
  const name = (id: string): string => entityName(state, id);
  const entry = (text: string, kind: CombatLogEntry['tone']): CombatLogEntry => ({
    id: event.eventId,
    text,
    tone: kind,
    at: Date.now(),
  });
  const skillLabel = (skillId: string | undefined): string =>
    skillId === undefined
      ? ''
      : (state.combatProfile?.skills.find((candidate) => candidate.id === skillId)?.name ?? '技能');
  const damageSuffix = (absorbed: number | undefined): string =>
    [
      event.kind === 'hit' && event.critical ? '（暴击）' : '',
      event.kind === 'hit' && event.periodic === true ? '（持续伤害）' : '',
      absorbed !== undefined && absorbed > 0 ? `（护盾吸收 ${String(absorbed)}）` : '',
    ].join('');

  switch (event.kind) {
    case 'hit': {
      const dealt = Math.max(0, event.damage - (event.absorbed ?? 0));
      const fullyAbsorbed = dealt === 0 && (event.absorbed ?? 0) > 0;
      if (event.sourceId === characterId) {
        if (fullyAbsorbed) {
          return entry(
            `你的攻击被 ${name(event.targetId)} 的护盾吸收 ${String(event.absorbed)} 点（完全抵挡）`,
            'self',
          );
        }
        const skill = skillLabel(event.skillId);
        return entry(
          `${skill.length > 0 ? `${skill}：` : ''}你对 ${name(event.targetId)} 造成 ${String(dealt)} 点伤害${damageSuffix(event.absorbed)}`,
          'self',
        );
      }
      if (event.targetId === characterId) {
        return fullyAbsorbed
          ? entry(
              `${name(event.sourceId)} 的攻击被你的护盾吸收 ${String(event.absorbed)} 点（完全抵挡）`,
              tone(event.sourceId),
            )
          : entry(
              `${name(event.sourceId)} 对你造成 ${String(dealt)} 点伤害${damageSuffix(event.absorbed)}`,
              tone(event.sourceId),
            );
      }
      return fullyAbsorbed
        ? entry(
            `${name(event.sourceId)} 的攻击被 ${name(event.targetId)} 的护盾吸收 ${String(event.absorbed)} 点（完全抵挡）`,
            'other',
          )
        : entry(
            `${name(event.sourceId)} 击中 ${name(event.targetId)}，${String(dealt)} 点伤害${damageSuffix(event.absorbed)}`,
            'other',
          );
    }
    case 'miss':
      if (event.sourceId === characterId) {
        return entry(`你的攻击被 ${name(event.targetId)} 闪避`, 'self');
      }
      if (event.targetId === characterId) {
        return entry(`你闪避了 ${name(event.sourceId)} 的攻击`, tone(event.sourceId));
      }
      return null;
    case 'heal':
      if (event.targetId === characterId) {
        return entry(`你恢复了 ${String(event.amount)} 点生命`, 'self');
      }
      if (event.sourceId === characterId) {
        return entry(`你为 ${name(event.targetId)} 恢复了 ${String(event.amount)} 点生命`, 'self');
      }
      return null;
    case 'death':
      if (event.entityId === characterId) {
        return entry(
          `你倒下了，${String(Math.max(1, Math.ceil((event.reviveInMs ?? 3_000) / 1_000)))} 秒后在地图复活点复活`,
          'system',
        );
      }
      return entry(
        `${name(event.entityId)} 被击败`,
        event.killerId === characterId ? 'self' : 'other',
      );
    case 'shield':
      if (event.targetId === characterId) {
        return event.amount > 0
          ? entry(`你获得了 ${String(event.amount)} 点护盾`, 'self')
          : entry('护盾已消散', 'system');
      }
      if (event.sourceId === characterId) {
        return entry(`你为 ${name(event.targetId)} 施加了护盾`, 'self');
      }
      return null;
    case 'respawn':
      return event.entityId === characterId ? entry('你已在地图出生点复活', 'system') : null;
    case 'spawn':
      return entry(`${event.displayName} 重新出现`, 'other');
    case 'telegraph':
      if (event.targetId === characterId) {
        return entry(`${name(event.sourceId)} 蓄势扑击，快离开红圈！`, 'system');
      }
      return null;
    case 'enrage':
      return entry(`${name(event.entityId)} 进入狂暴状态！`, 'system');
    case 'attack':
      return null;
  }
}

function resolveGameServerUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const sameOrigin = `${protocol}://${window.location.host}/ws`;
  if (import.meta.env.DEV) {
    return sameOrigin;
  }
  const override = import.meta.env.VITE_GAME_SERVER_URL;
  return typeof override === 'string' && override.length > 0 ? override : sameOrigin;
}

class WorldSession {
  private readonly bridge: WorldBridge;
  private readonly container: HTMLElement;
  private readonly options: WorldSessionOptions;
  private readonly updateState: (updater: (previous: SessionState) => SessionState) => void;
  private client: WorldClient | null = null;
  private game: Phaser.Game | null = null;
  private mapId: string;
  private commandCount = 0;
  private debugInstalled = false;
  private latestLoot: LootView[] = [];
  private latestSnapshot: WorldSnapshot | null = null;
  private inventory: InventorySnapshot | null = null;
  private shopCatalog: ShopCatalog | null = null;
  private shopRequestSequence = 0;
  private questRequestSequence = 0;
  /** Client-side intent re-issued after a map transfer or a reconnect. */
  private autoQuest: { questId: string; purpose: 'hunt' | 'return' | 'accept' } | null = null;
  private autoQuestSentMapId: string | null = null;
  private autoQuestPending: string | null = null;
  /** A drop the player clicked from out of range; walk there, then pick up. */
  private lootApproach: { dropId: string; expiresAt: number } | null = null;
  private bagPulseTimer: number | null = null;
  private autoClaimSent = false;
  private autoAcceptSent = false;
  private pendingNavCommandId: string | null = null;
  private quests: QuestView[] = [];
  private party: PartyView | null = null;
  private partyInvite: PartyInviteView | null = null;
  private partyInviteTimer: number | null = null;
  private levelBannerTimer: number | null = null;
  private systemMessageSequence = 0;
  private noticeSequence = 0;
  private readonly noticeTimers = new Map<string, number>();
  private readonly recentNoticeAt = new Map<string, number>();
  private readonly sfx = new SfxPlayer();

  constructor(
    container: HTMLElement,
    bridge: WorldBridge,
    options: WorldSessionOptions,
    updateState: (updater: (previous: SessionState) => SessionState) => void,
  ) {
    this.container = container;
    this.bridge = bridge;
    this.options = options;
    this.mapId = options.character.mapId;
    this.updateState = updateState;
    this.bridge.onMoveRequest = (tile) => {
      this.moveTo(tile);
    };
    this.bridge.onStopRequest = () => {
      this.stopMovement();
    };
    this.bridge.onAttackRequest = (targetId) => {
      this.attack(targetId);
    };
    this.bridge.onSkillRequest = (skillId, targetId) => {
      this.castSkill(skillId, targetId);
    };
    this.bridge.onTargetChange = (targetId) => {
      this.updateState((previous) => ({ ...previous, selectedTargetId: targetId }));
    };
    this.bridge.onPickupRequest = (dropId) => {
      this.pickup(dropId);
    };
    this.bridge.onNpcInteract = (npcId) => {
      this.interactNpc(npcId);
    };
  }

  start(): void {
    this.game = createWorldGame(this.container, this.bridge, mapBundleFor(this.mapId));
    this.installDebugHooks();

    const characterId = this.options.character.id;
    this.client = new WorldClient({
      url: resolveGameServerUrl(),
      characterId,
      mapId: this.mapId,
      requestTicket: this.options.requestTicket,
      roomPreference: loadRoomPreference(),
      freshTransfers: loadFreshTransfers(),
      callbacks: {
        onSnapshot: (snapshot) => {
          this.bridge.pushSnapshot({ snapshot, selfId: characterId });
          if (import.meta.env.DEV) {
            const debug = window.__webLegendDebug;
            if (debug !== undefined) {
              debug.lastSnapshotAt = Date.now();
              // Record the first moving snapshot after the probe is reset, so
              // the E2E log shows the update that made the move visible.
              if (
                snapshot.players.some((player) => player.moving) &&
                (debug.lastMovingSnapshotAt === undefined || debug.lastMovingSnapshotAt === 0)
              ) {
                debug.lastMovingSnapshotAt = Date.now();
              }
            }
          }
          this.latestLoot = snapshot.loot;
          this.latestSnapshot = snapshot;
          this.advanceLootApproach();
          this.updateState((previous) => ({
            ...previous,
            mapId: snapshot.mapId,
            instanceId: snapshot.instanceId,
            players: snapshot.players,
            monsters: snapshot.monsters,
            loot: snapshot.loot,
            serverTick: snapshot.tick,
            roomPlayerCount: snapshot.playerCount,
            selfId: characterId,
          }));
        },
        onStatus: (status, detail) => {
          if (status === 'reconnecting') {
            // The room drops guidance on disconnect; re-issue it after join.
            this.autoQuestSentMapId = null;
          }
          this.updateState((previous) => ({
            ...previous,
            status,
            detail,
            // A successful (re)join clears a previous moderator disconnect.
            ...(status === 'connected' ? { kicked: null } : {}),
          }));
          if (status === 'connected') {
            this.sendAutoQuestIntent();
          }
        },
        onRoom: (roomId) => {
          this.updateState((previous) => ({ ...previous, roomId }));
        },
        onAck: (ack) => {
          this.bridge.pushAck(ack);
          if (import.meta.env.DEV) {
            const debug = window.__webLegendDebug;
            if (debug !== undefined) {
              debug.lastAckAt = Date.now();
            }
          }
        },
        onRejected: (rejected) => {
          if (
            this.lootApproach !== null &&
            (rejected.code === 'UNREACHABLE' ||
              rejected.code === 'INVALID_TARGET' ||
              rejected.code === 'PLAYER_DEAD' ||
              rejected.code === 'INVALID_SESSION')
          ) {
            this.lootApproach = null;
          }
          if (this.autoQuestPending !== null) {
            this.autoQuestPending = null;
          }
          if (
            this.pendingNavCommandId !== null &&
            rejected.commandId === this.pendingNavCommandId
          ) {
            this.pendingNavCommandId = null;
            this.cancelAutoQuestLocally();
          } else if (this.autoClaimSent) {
            // The arrival hand-off failed (bag full, moved away, ...); stop
            // automation and let the player claim from the panel.
            this.autoClaimSent = false;
            this.cancelAutoQuestLocally();
          } else if (this.autoAcceptSent) {
            // The giver rejected the arrival hand-off; stop guiding and let
            // the player retry from the quest panel.
            this.autoAcceptSent = false;
            this.stopQuestNavigation();
          }
          this.pushNotice('warning', rejected.message);
        },
        onChat: (message) => {
          this.updateState((previous) => ({
            ...previous,
            messages: [...previous.messages, message].slice(-MAX_CHAT_MESSAGES),
          }));
        },
        onCombatProfile: (profile) => {
          this.updateState((previous) => ({
            ...previous,
            combatProfile: profile,
            shield:
              profile.shield !== undefined && profile.shield > 0
                ? { amount: profile.shield }
                : null,
          }));
        },
        onCombatEvent: (event) => {
          this.bridge.pushCombatEvent(event);
          this.playCombatSfx(event, characterId);
          if (import.meta.env.DEV) {
            const debug = window.__webLegendDebug;
            if (debug !== undefined) {
              debug.lastCombatEventAt = Date.now();
            }
          }
          this.updateState((previous) => {
            // Deduplicate first: the cooldown and shield bookkeeping below is
            // not idempotent if the same event ever arrives twice.
            if (previous.combatLog.some((entry) => entry.id === event.eventId)) {
              return previous;
            }
            let next = previous;
            if (
              event.kind === 'attack' &&
              event.sourceId === characterId &&
              event.skillId !== undefined
            ) {
              const skill = previous.combatProfile?.skills.find(
                (candidate) => candidate.id === event.skillId,
              );
              if (skill !== undefined) {
                next = {
                  ...next,
                  skillCooldowns: {
                    ...next.skillCooldowns,
                    [skill.id]: Date.now() + skill.cooldownMs,
                  },
                };
              }
            }
            if (event.kind === 'shield' && event.targetId === characterId) {
              next = {
                ...next,
                shield: event.amount > 0 ? { amount: event.amount } : null,
              };
            } else if (
              event.kind === 'hit' &&
              event.targetId === characterId &&
              event.absorbed !== undefined &&
              event.absorbed > 0 &&
              next.shield !== null
            ) {
              const remaining = Math.max(0, next.shield.amount - event.absorbed);
              next = { ...next, shield: remaining > 0 ? { amount: remaining } : null };
            }
            const logEntry = combatLogFor(next, event, characterId);
            if (logEntry !== null) {
              next = { ...next, combatLog: [...next.combatLog, logEntry].slice(-MAX_COMBAT_LOG) };
            }
            if (event.kind === 'death' && event.entityId === characterId) {
              next = {
                ...next,
                reviveAt: Date.now() + Math.max(0, event.reviveInMs ?? 3_000),
              };
            } else if (event.kind === 'respawn' && event.entityId === characterId) {
              next = { ...next, reviveAt: null };
            }
            return next;
          });
        },
        onTransfer: (mapId) => {
          this.handleTransfer(mapId);
        },
        onLatency: (latencyMs) => {
          this.updateState((previous) => ({ ...previous, latencyMs }));
        },
        onInventory: (snapshot) => {
          this.inventory = snapshot;
          this.updateState((previous) => ({ ...previous, inventory: snapshot }));
        },
        onShopCatalog: (catalog) => {
          this.shopCatalog = catalog;
          this.updateState((previous) => ({ ...previous, shopCatalog: catalog }));
        },
        onQuestSnapshot: (snapshot) => {
          // Collect progress arrives through snapshots (bag changes), not
          // quest updates; compare with the previous list so the player still
          // gets the same progress/completion feedback (ADR-040).
          const previous = new Map(this.quests.map((quest) => [quest.questId, quest]));
          this.quests = snapshot.quests;
          this.updateState((state) => ({ ...state, quests: snapshot.quests }));
          for (const quest of snapshot.quests) {
            const before = previous.get(quest.questId);
            if (before === undefined) {
              continue;
            }
            if (before.status !== 'completed' && quest.status === 'completed') {
              this.pushNotice(
                'info',
                `任务完成：${quest.title}，点击「回去交付」自动返回${quest.giverNpcName}`,
              );
            } else if (
              before.status === 'active' &&
              quest.status === 'active' &&
              quest.progress > before.progress
            ) {
              this.pushNotice(
                'info',
                `任务进度：${quest.title} ${questObjectiveProgressLabel(
                  quest.objective,
                  quest.progress,
                )}`,
              );
            }
          }
          this.sendAutoQuestIntent();
        },
        onQuestUpdate: (update) => {
          const previous = this.quests.find((quest) => quest.questId === update.quest.questId);
          this.quests =
            previous === undefined
              ? [...this.quests, update.quest]
              : this.quests.map((quest) =>
                  quest.questId === update.quest.questId ? update.quest : quest,
                );
          this.updateState((prev) => ({ ...prev, quests: this.quests }));

          if (
            update.quest.status === 'active' &&
            update.quest.progress > (previous?.progress ?? 0)
          ) {
            this.pushNotice(
              'info',
              `任务进度：${update.quest.title} ${questObjectiveProgressLabel(
                update.quest.objective,
                update.quest.progress,
              )}`,
            );
          }
          if (previous?.status !== 'completed' && update.quest.status === 'completed') {
            this.pushNotice(
              'info',
              `任务完成：${update.quest.title}，点击「回去交付」自动返回${update.quest.giverNpcName}`,
            );
          }
          if (previous?.status !== 'claimed' && update.quest.status === 'claimed') {
            const rewardParts = [
              update.quest.rewards.exp > 0 ? `经验 ${String(update.quest.rewards.exp)}` : '',
              update.quest.rewards.gold > 0 ? `金币 ${String(update.quest.rewards.gold)}` : '',
              ...update.quest.rewards.items.map((item) => `${item.name}×${String(item.quantity)}`),
            ].filter((part) => part.length > 0);
            this.pushNotice(
              'info',
              `任务已交付：${update.quest.title}${
                rewardParts.length === 0 ? '' : `（${rewardParts.join('，')}）`
              }`,
            );
          }
          if (this.autoQuestPending === update.quest.questId) {
            this.autoQuestPending = null;
            if (update.quest.status === 'active') {
              this.navigateQuest(update.quest.questId, 'hunt');
            }
          }
          if (this.autoQuest?.questId === update.quest.questId) {
            if (update.quest.status === 'completed' && this.autoQuest.purpose === 'hunt') {
              // The player decides when to return; the server stops the hunt.
              this.autoQuest = null;
              this.autoQuestSentMapId = null;
              this.pendingNavCommandId = null;
            } else if (update.quest.status === 'claimed') {
              this.cancelAutoQuestLocally();
            }
          }
        },
        onQuestNavigation: (navigation) => {
          if (navigation.status === 'arrived' && navigation.purpose === 'accept') {
            const quest = this.quests.find((entry) => entry.questId === navigation.questId);
            if (quest !== undefined && quest.status === 'available' && !this.autoAcceptSent) {
              this.autoAcceptSent = true;
              this.acceptQuest(navigation.questId, true);
              this.pushNotice('info', `已到达${quest.giverNpcName}，正在接取…`);
            }
            this.updateState((prev) => ({ ...prev, questNavigation: navigation }));
            return;
          }
          if (navigation.status === 'arrived' && navigation.purpose === 'return') {
            const quest = this.quests.find((entry) => entry.questId === navigation.questId);
            if (quest !== undefined && quest.status === 'completed' && !this.autoClaimSent) {
              this.autoClaimSent = true;
              this.claimQuest(navigation.questId);
              this.pushNotice('info', `已到达${quest.giverNpcName}，正在交付…`);
            }
            this.updateState((prev) => ({ ...prev, questNavigation: navigation }));
            return;
          }
          if (navigation.status === 'stopped') {
            const hadIntent = this.autoQuest !== null;
            this.autoQuest = null;
            this.autoQuestSentMapId = null;
            this.pendingNavCommandId = null;
            this.autoClaimSent = false;
            this.autoAcceptSent = false;
            this.updateState((prev) => ({ ...prev, questNavigation: null }));
            if (hadIntent && navigation.reason !== undefined && navigation.reason !== 'manual') {
              this.pushNotice('warning', questNavigationStopMessage(navigation.reason));
            }
            return;
          }
          if (navigation.status === 'completed') {
            this.autoQuest = null;
            this.autoQuestSentMapId = null;
            this.pendingNavCommandId = null;
            this.autoAcceptSent = false;
            this.updateState((prev) => ({ ...prev, questNavigation: null }));
            return;
          }
          this.updateState((prev) => ({ ...prev, questNavigation: navigation }));
        },
        onPartySnapshot: (snapshot) => {
          this.party = snapshot.party;
          // A roster update means the invite was accepted or withdrawn.
          if (snapshot.party !== null) {
            this.clearPartyInvite();
          }
          this.updateState((previous) => ({ ...previous, party: snapshot.party }));
        },
        onPartyInvite: (invite) => {
          this.partyInvite = invite;
          if (this.partyInviteTimer !== null) {
            window.clearTimeout(this.partyInviteTimer);
          }
          const remaining = Math.max(0, invite.expiresAt - Date.now());
          this.partyInviteTimer = window.setTimeout(() => {
            this.partyInviteTimer = null;
            this.clearPartyInvite();
          }, remaining);
          this.updateState((previous) => ({ ...previous, partyInvite: invite }));
        },
        onAssetResult: (result) => {
          this.inventory = result.snapshot;
          if (import.meta.env.DEV) {
            const debug = window.__webLegendDebug;
            if (debug !== undefined) {
              debug.lastAssetResultAt = Date.now();
            }
          }
          this.updateState((previous) => ({ ...previous, inventory: result.snapshot }));
        },
        onProgress: (progress) => {
          const next = withProgress(this.inventory, progress);
          this.inventory = next;
          this.updateState((previous) => ({
            ...previous,
            inventory: next ?? previous.inventory,
          }));
        },
        onLevelUp: (levelUp) => {
          this.sfx.play('levelup');
          if (this.levelBannerTimer !== null) {
            window.clearTimeout(this.levelBannerTimer);
          }
          this.updateState((previous) => ({
            ...previous,
            levelUpNotice: levelUp,
            combatLog: [
              ...previous.combatLog,
              {
                id: `level-${String(levelUp.level)}-${String(levelUp.serverTime)}`,
                text: `你升到了 Lv.${String(levelUp.level)}，生命与法力已恢复`,
                tone: 'system' as const,
                at: Date.now(),
              },
            ].slice(-MAX_COMBAT_LOG),
          }));
          this.levelBannerTimer = window.setTimeout(() => {
            this.levelBannerTimer = null;
            this.updateState((previous) => ({ ...previous, levelUpNotice: null }));
          }, 3_500);
        },
        onLootClaimed: (claimed) => {
          this.sfx.play('loot');
          this.bridge.playLootClaim(claimed);
          if (claimed.claimerId === characterId) {
            this.pulseBag();
          }
          this.updateState((previous) => ({
            ...previous,
            combatLog: [...previous.combatLog, lootLogEntry(claimed, characterId)].slice(
              -MAX_COMBAT_LOG,
            ),
          }));
        },
        onKicked: (notice) => {
          this.updateState((previous) => ({
            ...previous,
            status: 'disconnected',
            detail: notice.kind === 'banned' ? '账号已被封禁' : '已被管理员移出世界',
            kicked: notice,
          }));
        },
        onSystemNotice: (notice) => {
          this.systemMessageSequence += 1;
          const entry: SystemMessageEntry = {
            id: `system-${String(notice.serverTime)}-${String(this.systemMessageSequence)}`,
            kind: notice.kind,
            message: notice.message,
            at: Date.now(),
          };
          this.updateState((previous) => ({
            ...previous,
            systemMessages: [...previous.systemMessages, entry].slice(-MAX_SYSTEM_MESSAGES),
          }));
          if (notice.kind !== 'info') {
            this.pushNotice(notice.kind, notice.message);
          }
        },
        onCombatTargetChanged: (state) => {
          this.bridge.applyCombatTargetChanged(state);
          this.updateState((previous) => ({
            ...previous,
            autoAttack: state,
            selectedTargetId: state.targetId ?? previous.selectedTargetId,
          }));
        },
      },
    });

    void this.client.start();
  }

  moveTo(tile: TilePoint): void {
    // A manual move wins over a pending far-loot approach.
    this.lootApproach = null;
    if (import.meta.env.DEV) {
      const debug = window.__webLegendDebug;
      if (debug !== undefined) {
        debug.lastMoveIntentAt = Date.now();
      }
    }
    if (this.client?.sendMove(tile) === true) {
      this.commandCount += 1;
      this.cancelAutoQuestLocally();
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
  }

  /** Stops movement and auto-attack; the server keeps the current position. */
  stopMovement(): boolean {
    this.lootApproach = null;
    const sent = this.client?.sendMoveStop() ?? false;
    if (sent) {
      this.commandCount += 1;
      this.cancelAutoQuestLocally();
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  /** Locks the target; the server keeps swinging until told to stop. */
  attack(targetId: string): boolean {
    this.lootApproach = null;
    const sent = this.client?.sendEngage(targetId) ?? false;
    if (sent) {
      this.commandCount += 1;
      this.cancelAutoQuestLocally();
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
      if (import.meta.env.DEV) {
        const debug = window.__webLegendDebug;
        if (debug !== undefined) {
          debug.lastAttackIntentAt = Date.now();
        }
      }
    }
    return sent;
  }

  stopAutoAttack(): boolean {
    const sent = this.client?.sendAutoAttackStop() ?? false;
    if (sent) {
      this.commandCount += 1;
      this.cancelAutoQuestLocally();
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  resumeAutoAttack(): boolean {
    const sent = this.client?.sendAutoAttackStart() ?? false;
    if (sent) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  selectTarget(monsterId: string): void {
    this.bridge.selectTarget(monsterId);
  }

  castSkill(skillId: string, targetId: string): boolean {
    this.lootApproach = null;
    const sent = this.client?.sendSkill(skillId, targetId) ?? false;
    if (sent) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  /**
   * Picking a drop from out of range walks there first (ADR-041). The lock and
   * the final distance are still enforced by the server.
   */
  pickup(dropId: string): boolean {
    const drop = this.latestLoot.find((entry) => entry.dropId === dropId);
    if (drop === undefined) {
      return false;
    }
    const now = Date.now();
    if (lootIsLocked(drop, now)) {
      this.pushNotice('info', lootLockLabel(drop, now) ?? '物品仍在争夺保护中');
      return false;
    }
    const self = this.latestSnapshot?.players.find(
      (player) => player.playerId === this.options.character.id,
    );
    if (self !== undefined && !withinPickupRange(self, drop)) {
      this.moveTo(lootTile(drop));
      this.lootApproach = { dropId, expiresAt: now + LOOT_APPROACH_TIMEOUT_MS };
      this.pushNotice('info', `正在走向${drop.displayName}…`);
      return true;
    }
    return this.sendPickup(dropId);
  }

  private sendPickup(dropId: string): boolean {
    const sent = this.client?.sendPickup(dropId) ?? false;
    if (sent) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  /** Brief bag glow after the local player receives a drop (ADR-041). */
  private pulseBag(): void {
    if (this.bagPulseTimer !== null) {
      window.clearTimeout(this.bagPulseTimer);
    }
    this.updateState((previous) => ({ ...previous, bagPulse: true }));
    this.bagPulseTimer = window.setTimeout(() => {
      this.bagPulseTimer = null;
      this.updateState((previous) => ({ ...previous, bagPulse: false }));
    }, 650);
  }

  /** Completes a far-click pickup once the snapshot shows the player in range. */
  private advanceLootApproach(): void {
    const approach = this.lootApproach;
    if (approach === null) {
      return;
    }
    const now = Date.now();
    if (now > approach.expiresAt) {
      this.lootApproach = null;
      return;
    }
    const self = this.latestSnapshot?.players.find(
      (player) => player.playerId === this.options.character.id,
    );
    const drop = this.latestLoot.find((entry) => entry.dropId === approach.dropId);
    if (self === undefined || !self.alive || drop === undefined) {
      this.lootApproach = null;
      return;
    }
    if (lootIsLocked(drop, now)) {
      this.pushNotice('info', lootLockLabel(drop, now) ?? '物品仍在争夺保护中');
      this.lootApproach = null;
      return;
    }
    if (withinPickupRange(self, drop)) {
      this.lootApproach = null;
      this.sendPickup(drop.dropId);
    }
  }

  equip(itemId: string): boolean {
    const sent = this.client?.sendEquip(itemId) ?? false;
    if (sent) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  unequip(slot: EquipmentSlot): boolean {
    const sent = this.client?.sendUnequip(slot) ?? false;
    if (sent) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  consumeItem(itemId: string): boolean {
    const sent = this.client?.sendUse(itemId) ?? false;
    if (sent) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  interactNpc(npcId: string): void {
    const self = this.latestSnapshot?.players.find(
      (player) => player.playerId === this.options.character.id,
    );
    if (self === undefined) {
      return;
    }
    const merchant = this.shopCatalog?.merchants.find((entry) => entry.id === npcId);
    if (merchant !== undefined) {
      const distance = Math.hypot(
        self.x / TILE_UNITS - merchant.tile.x,
        self.y / TILE_UNITS - merchant.tile.y,
      );
      if (distance > SHOP_RANGE_TILES) {
        this.pushNotice('warning', `走近${merchant.name}后再交易`);
        return;
      }
      this.shopRequestSequence += 1;
      this.updateState((previous) => ({
        ...previous,
        shopRequest: { npcId, seq: this.shopRequestSequence },
      }));
      return;
    }

    const quest = this.quests.find((entry) => entry.giverNpcId === npcId);
    if (quest === undefined) {
      return;
    }
    const npc = mapBundleFor(this.mapId).manifest.npcPoints.find((entry) => entry.id === npcId);
    if (npc === undefined) {
      return;
    }
    const distance = Math.hypot(self.x / TILE_UNITS - npc.tile.x, self.y / TILE_UNITS - npc.tile.y);
    if (distance > QUEST_NPC_RANGE_TILES) {
      this.pushNotice('warning', `走近${npc.name}后再交谈`);
      return;
    }
    this.questRequestSequence += 1;
    this.updateState((previous) => ({
      ...previous,
      questRequest: { npcId, seq: this.questRequestSequence },
    }));
  }

  /** Asks the server to accept a quest at its giver; the server re-checks range. */
  acceptQuest(questId: string, huntAfter = false): boolean {
    const sent = this.client?.sendQuestAccept(questId) ?? false;
    if (sent) {
      this.commandCount += 1;
      if (huntAfter) {
        this.autoQuestPending = questId;
      }
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  /** Turns in a completed quest; rewards commit server-side before the update. */
  claimQuest(questId: string): boolean {
    const sent = this.client?.sendQuestClaim(questId) ?? false;
    if (sent) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  /**
   * Starts server-authored quest guidance (ADR-039): the server walks the
   * character to the target or giver, and the browser only renders the state.
   */
  navigateQuest(questId: string, purpose: QuestNavigationPurpose): boolean {
    if (purpose === 'stop') {
      const sent = this.client?.sendQuestNavigate(questId, 'stop') ?? null;
      this.cancelAutoQuestLocally();
      return sent !== null;
    }
    const commandId = this.client?.sendQuestNavigate(questId, purpose) ?? null;
    if (commandId === null) {
      return false;
    }
    this.autoQuest = { questId, purpose };
    this.autoQuestSentMapId = this.mapId;
    this.autoClaimSent = false;
    this.autoAcceptSent = false;
    this.pendingNavCommandId = commandId;
    this.updateState((previous) => ({
      ...previous,
      questNavigation: { questId, purpose, status: 'moving', serverTime: Date.now() },
    }));
    return true;
  }

  stopQuestNavigation(): boolean {
    const intent = this.autoQuest;
    if (intent === null) {
      return false;
    }
    return this.navigateQuest(intent.questId, 'stop');
  }

  private cancelAutoQuestLocally(): void {
    const wasActive =
      this.autoQuest !== null ||
      this.autoQuestPending !== null ||
      this.autoQuestSentMapId !== null ||
      this.pendingNavCommandId !== null;
    this.autoQuest = null;
    this.autoQuestSentMapId = null;
    this.autoQuestPending = null;
    this.autoClaimSent = false;
    this.autoAcceptSent = false;
    this.pendingNavCommandId = null;
    if (wasActive) {
      this.updateState((previous) =>
        previous.questNavigation === null ? previous : { ...previous, questNavigation: null },
      );
    }
  }

  /** Re-issues the client's intent once the new room is joined. */
  private sendAutoQuestIntent(): void {
    const intent = this.autoQuest;
    if (intent === null || this.autoQuestSentMapId === this.mapId) {
      return;
    }
    const commandId = this.client?.sendQuestNavigate(intent.questId, intent.purpose) ?? null;
    if (commandId === null) {
      return;
    }
    this.autoQuestSentMapId = this.mapId;
    this.pendingNavCommandId = commandId;
  }

  /** Invites a visible player; the server re-checks distance, party size and state. */
  inviteToParty(targetPlayerId: string): boolean {
    const sent = this.client?.sendPartyInvite(targetPlayerId) ?? false;
    if (sent) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  acceptPartyInvite(): boolean {
    const invite = this.partyInvite;
    if (invite === null) {
      return false;
    }
    const sent = this.client?.sendPartyAccept(invite.inviteId) ?? false;
    if (sent) {
      this.clearPartyInvite();
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  declinePartyInvite(): boolean {
    const invite = this.partyInvite;
    if (invite === null) {
      return false;
    }
    const sent = this.client?.sendPartyDecline(invite.inviteId) ?? false;
    if (sent) {
      this.clearPartyInvite();
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  leaveParty(): boolean {
    if (this.party === null) {
      return false;
    }
    const sent = this.client?.sendPartyLeave() ?? false;
    if (sent) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  /** Leader-only; the server re-checks leadership and membership. */
  transferPartyLeader(targetPlayerId: string): boolean {
    if (this.party === null) {
      return false;
    }
    const sent = this.client?.sendPartyTransferLeader(targetPlayerId) ?? false;
    if (sent) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  /** Leader-only; the server re-checks leadership and membership. */
  kickPartyMember(targetPlayerId: string): boolean {
    if (this.party === null) {
      return false;
    }
    const sent = this.client?.sendPartyKick(targetPlayerId) ?? false;
    if (sent) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  private clearPartyInvite(): void {
    if (this.partyInviteTimer !== null) {
      window.clearTimeout(this.partyInviteTimer);
      this.partyInviteTimer = null;
    }
    this.partyInvite = null;
    this.updateState((previous) => ({ ...previous, partyInvite: null }));
  }

  shopBuy(merchantId: string, templateId: string, quantity: number): boolean {
    const sent = this.client?.sendShopBuy(merchantId, templateId, quantity) ?? false;
    if (sent) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  shopSell(merchantId: string, itemId: string, quantity: number): boolean {
    const sent = this.client?.sendShopSell(merchantId, itemId, quantity) ?? false;
    if (sent) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  sendChat(text: string, channel: ChatChannel = 'map'): boolean {
    return this.client?.sendChat(text, channel) ?? false;
  }

  rejoin(): void {
    if (this.client === null) {
      this.start();
      return;
    }
    this.clearNotices();
    this.updateState((previous) => ({
      ...previous,
      status: 'connecting',
      detail: '正在重新加入世界',
      kicked: null,
      autoAttack: null,
    }));
    void this.client.restart();
  }

  async leave(): Promise<void> {
    this.cancelAutoQuestLocally();
    const client = this.client;
    this.client = null;
    if (client !== null) {
      await client.stop();
    }
    this.updateState((previous) => ({
      ...previous,
      status: 'disconnected',
      detail: '已离开世界',
      players: [],
      kicked: null,
    }));
  }

  toggleSfx(): boolean {
    const muted = !this.sfx.isMuted;
    this.sfx.setMuted(muted);
    this.updateState((previous) => ({ ...previous, sfxMuted: muted }));
    return muted;
  }

  async dispose(): Promise<void> {
    this.removeDebugHooks();
    this.sfx.dispose();
    for (const timer of this.noticeTimers.values()) {
      window.clearTimeout(timer);
    }
    this.noticeTimers.clear();
    if (this.levelBannerTimer !== null) {
      window.clearTimeout(this.levelBannerTimer);
      this.levelBannerTimer = null;
    }
    if (this.bagPulseTimer !== null) {
      window.clearTimeout(this.bagPulseTimer);
      this.bagPulseTimer = null;
    }
    if (this.partyInviteTimer !== null) {
      window.clearTimeout(this.partyInviteTimer);
      this.partyInviteTimer = null;
    }
    const client = this.client;
    this.client = null;
    if (client !== null) {
      await client.stop();
    }

    const game = this.game;
    this.game = null;
    game?.destroy(true);
  }

  /**
   * Rejection and warning toasts. The old single banner never cleared, so one
   * stray click covered the skill bar for the rest of the session (TD-CLI-02).
   */
  private pushNotice(kind: SessionNotice['kind'], message: string): void {
    const now = Date.now();
    // Deduplicate synchronously: React may defer the state updater, and the
    // dismissal timer must be scheduled in this call, not inside it.
    const previousAt = this.recentNoticeAt.get(message);
    if (previousAt !== undefined && now - previousAt < 1_500) {
      return;
    }
    for (const [key, at] of this.recentNoticeAt) {
      if (now - at >= 1_500) {
        this.recentNoticeAt.delete(key);
      }
    }
    this.recentNoticeAt.set(message, now);

    const id = `notice-${String(now)}-${String((this.noticeSequence += 1))}`;
    this.updateState((previous) => ({
      ...previous,
      notices: [...previous.notices, { id, kind, message, at: now }].slice(-3),
    }));
    const timer = window.setTimeout(() => {
      this.noticeTimers.delete(id);
      this.updateState((previous) => ({
        ...previous,
        notices: previous.notices.filter((notice) => notice.id !== id),
      }));
    }, 4_000);
    this.noticeTimers.set(id, timer);
  }

  private clearNotices(): void {
    for (const timer of this.noticeTimers.values()) {
      window.clearTimeout(timer);
    }
    this.noticeTimers.clear();
    this.updateState((previous) => ({ ...previous, notices: [] }));
  }

  private playCombatSfx(event: CombatEvent, characterId: string): void {
    switch (event.kind) {
      case 'attack':
        if (event.sourceId === characterId) {
          this.sfx.play('attack');
        }
        break;
      case 'hit':
        if (event.targetId === characterId) {
          this.sfx.play('hurt');
        } else if (event.sourceId === characterId) {
          this.sfx.play('hit');
        }
        break;
      case 'heal':
        if (event.targetId === characterId) {
          this.sfx.play('heal');
        }
        break;
      case 'shield':
        if (event.targetId === characterId && event.amount > 0) {
          this.sfx.play('heal');
        }
        break;
      case 'death':
        if (event.entityId === characterId) {
          this.sfx.play('death');
        } else if (event.killerId === characterId) {
          this.sfx.play('kill');
        }
        break;
      case 'respawn':
        if (event.entityId === characterId) {
          this.sfx.play('heal');
        }
        break;
      case 'telegraph':
        if (event.targetId === characterId) {
          this.sfx.play('warn');
        }
        break;
      default:
        break;
    }
  }

  private handleTransfer(mapId: string): void {
    this.shopCatalog = null;
    this.quests = [];
    this.party = null;
    this.partyInvite = null;
    // The guidance intent survives the transfer; the new room gets it again.
    this.autoQuestSentMapId = null;
    this.autoClaimSent = false;
    this.autoAcceptSent = false;
    this.pendingNavCommandId = null;
    if (this.partyInviteTimer !== null) {
      window.clearTimeout(this.partyInviteTimer);
      this.partyInviteTimer = null;
    }
    this.latestSnapshot = null;
    for (const timer of this.noticeTimers.values()) {
      window.clearTimeout(timer);
    }
    this.noticeTimers.clear();
    this.updateState((previous) => ({
      ...previous,
      status: 'connecting',
      detail: '正在前往新的地图',
      mapId,
      players: [],
      monsters: [],
      loot: [],
      messages: [],
      systemMessages: [],
      roomPlayerCount: 0,
      combatProfile: null,
      combatLog: [],
      selectedTargetId: null,
      skillCooldowns: {},
      shield: null,
      shopCatalog: null,
      shopRequest: null,
      quests: [],
      questNavigation:
        this.autoQuest === null
          ? null
          : {
              questId: this.autoQuest.questId,
              purpose: this.autoQuest.purpose,
              status: 'moving',
              serverTime: Date.now(),
            },
      questRequest: null,
      party: null,
      partyInvite: null,
      levelUpNotice: null,
      notices: [],
      autoAttack: null,
      reviveAt: null,
    }));
    this.switchMap(mapId);
    if (this.client !== null) {
      void this.client.transferTo(mapId);
    }
  }

  private switchMap(mapId: string): void {
    this.mapId = mapId;
    const game = this.game;
    this.game = null;
    game?.destroy(true);
    this.bridge.reset();
    this.game = createWorldGame(this.container, this.bridge, mapBundleFor(mapId));
  }

  private installDebugHooks(): void {
    if (!import.meta.env.DEV) {
      return;
    }
    window.__webLegendDebug = {
      screenPointForTile: (tileX, tileY) => this.bridge.screenPointForTile({ x: tileX, y: tileY }),
      restartScene: () => this.bridge.restartScene(),
      sceneGeneration: () => this.bridge.sceneGeneration(),
      dropConnection: () => this.client?.dropConnection() ?? false,
      leaveWorld: () => this.leave(),
      currentMapId: () => this.client?.currentMapId ?? this.mapId,
      moveToTile: (tileX, tileY) => {
        this.moveTo({ x: tileX, y: tileY });
        return true;
      },
      attackMonster: (monsterId) => this.attack(monsterId),
      attackPlayer: (playerId) => {
        this.selectTarget(playerId);
        return this.attack(playerId);
      },
      stopAutoAttack: () => this.stopAutoAttack(),
      startAutoAttack: () => this.resumeAutoAttack(),
      castSkill: (skillId, targetId) => this.castSkill(skillId, targetId),
      monsterScreenPoint: (monsterId) => this.bridge.monsterScreenPoint(monsterId),
      playerScreenPoint: (playerId) => this.bridge.playerScreenPoint(playerId),
      selfAppearance: () =>
        this.bridge.playerAppearance(this.options.character.id) ?? {
          textureKey: 'unknown',
          clip: 'idle',
          frame: '',
        },
      selfId: () => this.options.character.id,
      selfUnitPosition: () => this.bridge.selfUnitPosition(),
      selfServerPosition: () => this.bridge.selfServerPosition(),
      playerAppearance: (playerId) => this.bridge.playerAppearance(playerId),
      activeTelegraphs: () => this.bridge.activeTelegraphs(),
      npcScreenPoint: (npcId) => this.bridge.npcScreenPoint(npcId),
      interactNpc: (npcId) => this.interactNpc(npcId),
      sendChat: (text, channel) => this.sendChat(text, channel),
      pickupDrop: (dropId) => this.pickup(dropId),
      equipItem: (itemId) => this.equip(itemId),
      unequipSlot: (slot) => this.unequip(slot),
      useItem: (itemId) => this.consumeItem(itemId),
      buyFromShop: (merchantId, templateId, quantity) =>
        this.shopBuy(merchantId, templateId, quantity),
      sellToShop: (merchantId, itemId, quantity) => this.shopSell(merchantId, itemId, quantity),
      acceptQuest: (questId) => this.acceptQuest(questId),
      acceptQuestAndHunt: (questId) => this.acceptQuest(questId, true),
      claimQuest: (questId) => this.claimQuest(questId),
      navigateQuest: (questId, purpose) => this.navigateQuest(questId, purpose),
      questState: () => this.quests,
      questNavigationState: () => this.autoQuest,
      inviteToParty: (playerId) => this.inviteToParty(playerId),
      acceptPartyInvite: () => this.acceptPartyInvite(),
      declinePartyInvite: () => this.declinePartyInvite(),
      leaveParty: () => this.leaveParty(),
      transferPartyLeader: (playerId) => this.transferPartyLeader(playerId),
      kickPartyMember: (playerId) => this.kickPartyMember(playerId),
      partyState: () => this.party,
      partyInviteState: () => this.partyInvite,
      lootDrops: () => this.latestLoot,
      lootScreenPoint: (dropId) => this.bridge.lootScreenPoint(dropId),
      lootIconFrame: (dropId) => this.bridge.lootIconFrame(dropId),
      labels: () => this.bridge.labels(),
      inventoryState: () => this.inventory,
    };
    this.debugInstalled = true;
  }

  private removeDebugHooks(): void {
    if (this.debugInstalled) {
      delete window.__webLegendDebug;
      this.debugInstalled = false;
    }
  }
}

export type WorldSessionControls = {
  state: SessionState;
  rejoin: () => void;
  sendChat: (text: string, channel?: ChatChannel) => boolean;
  castSkill: (skillId: string, targetId: string) => boolean;
  selectTarget: (monsterId: string) => void;
  attack: (targetId: string) => boolean;
  stopAutoAttack: () => boolean;
  resumeAutoAttack: () => boolean;
  pickup: (dropId: string) => boolean;
  equip: (itemId: string) => boolean;
  unequip: (slot: EquipmentSlot) => boolean;
  consumeItem: (itemId: string) => boolean;
  shopBuy: (merchantId: string, templateId: string, quantity: number) => boolean;
  shopSell: (merchantId: string, itemId: string, quantity: number) => boolean;
  acceptQuest: (questId: string) => boolean;
  acceptQuestAndHunt: (questId: string) => boolean;
  claimQuest: (questId: string) => boolean;
  navigateQuest: (questId: string, purpose: QuestNavigationPurpose) => boolean;
  stopQuestNavigation: () => boolean;
  inviteToParty: (targetPlayerId: string) => boolean;
  acceptPartyInvite: () => boolean;
  declinePartyInvite: () => boolean;
  leaveParty: () => boolean;
  transferPartyLeader: (targetPlayerId: string) => boolean;
  kickPartyMember: (targetPlayerId: string) => boolean;
  toggleSfx: () => void;
};

/**
 * Owns one Phaser game and one world connection for the selected character.
 * The ticket callback is kept in a ref so a re-render never restarts the world.
 */
export function useWorldSession(
  containerRef: RefObject<HTMLDivElement | null>,
  options: WorldSessionOptions,
): WorldSessionControls {
  const characterId = options.character.id;
  const [state, setState] = useState<SessionState>(() => initialState(options.character));
  const sessionRef = useRef<WorldSession | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const bridge = new WorldBridge();
    const session = new WorldSession(container, bridge, optionsRef.current, (updater) => {
      setState(updater);
    });
    sessionRef.current = session;

    // Defer the start so React StrictMode's mount/unmount probe does not open
    // two connections or create two Phaser games.
    const timer = window.setTimeout(() => {
      session.start();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      sessionRef.current = null;
      void session.dispose();
    };
  }, [containerRef, characterId]);

  const rejoin = useCallback(() => {
    sessionRef.current?.rejoin();
  }, []);

  const sendChat = useCallback(
    (text: string, channel: ChatChannel = 'map') =>
      sessionRef.current?.sendChat(text, channel) ?? false,
    [],
  );
  const castSkill = useCallback(
    (skillId: string, targetId: string) =>
      sessionRef.current?.castSkill(skillId, targetId) ?? false,
    [],
  );
  const selectTarget = useCallback((monsterId: string) => {
    sessionRef.current?.selectTarget(monsterId);
  }, []);
  const attack = useCallback(
    (targetId: string) => sessionRef.current?.attack(targetId) ?? false,
    [],
  );
  const stopAutoAttack = useCallback(() => sessionRef.current?.stopAutoAttack() ?? false, []);
  const resumeAutoAttack = useCallback(() => sessionRef.current?.resumeAutoAttack() ?? false, []);
  const pickup = useCallback((dropId: string) => sessionRef.current?.pickup(dropId) ?? false, []);
  const equip = useCallback((itemId: string) => sessionRef.current?.equip(itemId) ?? false, []);
  const unequip = useCallback(
    (slot: EquipmentSlot) => sessionRef.current?.unequip(slot) ?? false,
    [],
  );
  const consumeItem = useCallback(
    (itemId: string) => sessionRef.current?.consumeItem(itemId) ?? false,
    [],
  );
  const shopBuy = useCallback(
    (merchantId: string, templateId: string, quantity: number) =>
      sessionRef.current?.shopBuy(merchantId, templateId, quantity) ?? false,
    [],
  );
  const shopSell = useCallback(
    (merchantId: string, itemId: string, quantity: number) =>
      sessionRef.current?.shopSell(merchantId, itemId, quantity) ?? false,
    [],
  );
  const acceptQuest = useCallback(
    (questId: string) => sessionRef.current?.acceptQuest(questId) ?? false,
    [],
  );
  const acceptQuestAndHunt = useCallback(
    (questId: string) => sessionRef.current?.acceptQuest(questId, true) ?? false,
    [],
  );
  const claimQuest = useCallback(
    (questId: string) => sessionRef.current?.claimQuest(questId) ?? false,
    [],
  );
  const navigateQuest = useCallback(
    (questId: string, purpose: QuestNavigationPurpose) =>
      sessionRef.current?.navigateQuest(questId, purpose) ?? false,
    [],
  );
  const stopQuestNavigation = useCallback(
    () => sessionRef.current?.stopQuestNavigation() ?? false,
    [],
  );
  const inviteToParty = useCallback(
    (targetPlayerId: string) => sessionRef.current?.inviteToParty(targetPlayerId) ?? false,
    [],
  );
  const acceptPartyInvite = useCallback(() => sessionRef.current?.acceptPartyInvite() ?? false, []);
  const declinePartyInvite = useCallback(
    () => sessionRef.current?.declinePartyInvite() ?? false,
    [],
  );
  const leaveParty = useCallback(() => sessionRef.current?.leaveParty() ?? false, []);
  const transferPartyLeader = useCallback(
    (targetPlayerId: string) => sessionRef.current?.transferPartyLeader(targetPlayerId) ?? false,
    [],
  );
  const kickPartyMember = useCallback(
    (targetPlayerId: string) => sessionRef.current?.kickPartyMember(targetPlayerId) ?? false,
    [],
  );
  const toggleSfx = useCallback(() => {
    sessionRef.current?.toggleSfx();
  }, []);

  return {
    state,
    rejoin,
    sendChat,
    castSkill,
    selectTarget,
    attack,
    stopAutoAttack,
    resumeAutoAttack,
    pickup,
    equip,
    unequip,
    consumeItem,
    shopBuy,
    shopSell,
    acceptQuest,
    acceptQuestAndHunt,
    claimQuest,
    navigateQuest,
    stopQuestNavigation,
    inviteToParty,
    acceptPartyInvite,
    declinePartyInvite,
    leaveParty,
    transferPartyLeader,
    kickPartyMember,
    toggleSfx,
  };
}
