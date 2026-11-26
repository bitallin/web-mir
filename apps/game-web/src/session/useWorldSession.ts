import { SHOP_RANGE_TILES, TILE_UNITS } from '@web-legend/contracts';
import type {
  CharacterView,
  CharacterProgress,
  ChatMessage,
  CombatEvent,
  CombatProfile,
  CombatTargetChanged,
  EquipmentSlot,
  InventorySnapshot,
  LevelUp,
  LootClaimed,
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
import { loadRoomPreference } from '../lib/identity';
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
  levelUpNotice: LevelUp | null;
  /** Transient toasts; each removes itself after a few seconds (TD-CLI-02). */
  notices: SessionNotice[];
  /** Server-owned auto-attack status for the locked target. */
  autoAttack: CombatTargetChanged | null;
  /** Client clock deadline for the local player's automatic revival. */
  reviveAt: number | null;
  kicked: SessionKicked | null;
  sfxMuted: boolean;
};

export type WorldSessionOptions = {
  character: CharacterView;
  requestTicket: () => Promise<string>;
};

const MAX_CHAT_MESSAGES = 120;
const MAX_SYSTEM_MESSAGES = 60;
const MAX_COMBAT_LOG = 12;

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
    levelUpNotice: null,
    notices: [],
    autoAttack: null,
    reviveAt: null,
    kicked: null,
    sfxMuted: isSfxMuted(),
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
          this.updateState((previous) => ({
            ...previous,
            status,
            detail,
            // A successful (re)join clears a previous moderator disconnect.
            ...(status === 'connected' ? { kicked: null } : {}),
          }));
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
    if (import.meta.env.DEV) {
      const debug = window.__webLegendDebug;
      if (debug !== undefined) {
        debug.lastMoveIntentAt = Date.now();
      }
    }
    if (this.client?.sendMove(tile) === true) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
  }

  /** Locks the target; the server keeps swinging until told to stop. */
  attack(targetId: string): boolean {
    const sent = this.client?.sendEngage(targetId) ?? false;
    if (sent) {
      this.commandCount += 1;
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
    const sent = this.client?.sendSkill(skillId, targetId) ?? false;
    if (sent) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
  }

  pickup(dropId: string): boolean {
    const sent = this.client?.sendPickup(dropId) ?? false;
    if (sent) {
      this.commandCount += 1;
      this.updateState((previous) => ({ ...previous, commandCount: this.commandCount }));
    }
    return sent;
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
    const merchant = this.shopCatalog?.merchants.find((entry) => entry.id === npcId);
    if (merchant === undefined) {
      return;
    }
    const self = this.latestSnapshot?.players.find(
      (player) => player.playerId === this.options.character.id,
    );
    if (self === undefined) {
      return;
    }
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

  sendChat(text: string): boolean {
    return this.client?.sendChat(text) ?? false;
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
      playerAppearance: (playerId) => this.bridge.playerAppearance(playerId),
      activeTelegraphs: () => this.bridge.activeTelegraphs(),
      npcScreenPoint: (npcId) => this.bridge.npcScreenPoint(npcId),
      interactNpc: (npcId) => this.interactNpc(npcId),
      sendChat: (text) => this.sendChat(text),
      pickupDrop: (dropId) => this.pickup(dropId),
      equipItem: (itemId) => this.equip(itemId),
      unequipSlot: (slot) => this.unequip(slot),
      useItem: (itemId) => this.consumeItem(itemId),
      buyFromShop: (merchantId, templateId, quantity) =>
        this.shopBuy(merchantId, templateId, quantity),
      sellToShop: (merchantId, itemId, quantity) => this.shopSell(merchantId, itemId, quantity),
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
  sendChat: (text: string) => boolean;
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

  const sendChat = useCallback((text: string) => sessionRef.current?.sendChat(text) ?? false, []);
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
    toggleSfx,
  };
}
