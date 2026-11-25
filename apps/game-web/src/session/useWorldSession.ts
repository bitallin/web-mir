import type {
  CharacterView,
  CharacterProgress,
  ChatMessage,
  CombatEvent,
  CombatProfile,
  EquipmentSlot,
  InventorySnapshot,
  LevelUp,
  LootClaimed,
  TilePoint,
} from '@web-legend/contracts';
import type Phaser from 'phaser';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { createWorldGame } from '../game/createWorldGame';
import { mapBundleFor } from '../game/mapCatalog';
import { WorldBridge } from '../game/worldBridge';
import { loadRoomPreference } from '../lib/identity';
import {
  WorldClient,
  type ConnectionStatus,
  type LootView,
  type MonsterView,
  type PlayerView,
} from '../net/worldClient';

export type SessionNotice = {
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
  combatProfile: CombatProfile | null;
  combatLog: CombatLogEntry[];
  selectedTargetId: string | null;
  skillCooldowns: Record<string, number>;
  inventory: InventorySnapshot | null;
  levelUpNotice: LevelUp | null;
  notice: SessionNotice | null;
};

export type WorldSessionOptions = {
  character: CharacterView;
  requestTicket: () => Promise<string>;
};

const MAX_CHAT_MESSAGES = 120;
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
    combatProfile: null,
    combatLog: [],
    selectedTargetId: null,
    skillCooldowns: {},
    inventory: null,
    levelUpNotice: null,
    notice: null,
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

  switch (event.kind) {
    case 'hit':
      if (event.sourceId === characterId) {
        return entry(
          `你对 ${name(event.targetId)} 造成 ${String(event.damage)} 点伤害${
            event.critical ? '（暴击）' : ''
          }`,
          'self',
        );
      }
      if (event.targetId === characterId) {
        return entry(
          `${name(event.sourceId)} 对你造成 ${String(event.damage)} 点伤害${
            event.critical ? '（暴击）' : ''
          }`,
          tone(event.sourceId),
        );
      }
      return entry(
        `${name(event.sourceId)} 击中 ${name(event.targetId)}，${String(event.damage)} 点伤害`,
        'other',
      );
    case 'miss':
      if (event.sourceId === characterId) {
        return entry(`你的攻击被 ${name(event.targetId)} 闪避`, 'self');
      }
      if (event.targetId === characterId) {
        return entry(`你闪避了 ${name(event.sourceId)} 的攻击`, tone(event.sourceId));
      }
      return null;
    case 'heal':
      return entry(`你恢复了 ${String(event.amount)} 点生命`, 'self');
    case 'death':
      if (event.entityId === characterId) {
        return entry('你倒下了，3 秒后在地图出生点复活', 'system');
      }
      return entry(
        `${name(event.entityId)} 被击败`,
        event.killerId === characterId ? 'self' : 'other',
      );
    case 'respawn':
      return entry('你已在地图出生点复活', 'system');
    case 'spawn':
      return entry(`${event.displayName} 重新出现`, 'other');
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
  private inventory: InventorySnapshot | null = null;
  private levelBannerTimer: number | null = null;

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
          this.updateState((previous) => ({ ...previous, status, detail }));
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
          this.updateState((previous) => ({
            ...previous,
            notice: { kind: 'warning', message: rejected.message, at: Date.now() },
          }));
        },
        onChat: (message) => {
          this.updateState((previous) => ({
            ...previous,
            messages: [...previous.messages, message].slice(-MAX_CHAT_MESSAGES),
          }));
        },
        onCombatProfile: (profile) => {
          this.updateState((previous) => ({ ...previous, combatProfile: profile }));
        },
        onCombatEvent: (event) => {
          this.bridge.pushCombatEvent(event);
          if (import.meta.env.DEV) {
            const debug = window.__webLegendDebug;
            if (debug !== undefined) {
              debug.lastCombatEventAt = Date.now();
            }
          }
          this.updateState((previous) => {
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
            if (next.combatLog.some((entry) => entry.id === event.eventId)) {
              return next;
            }
            const logEntry = combatLogFor(next, event, characterId);
            if (logEntry !== null) {
              next = { ...next, combatLog: [...next.combatLog, logEntry].slice(-MAX_COMBAT_LOG) };
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
          this.updateState((previous) => ({
            ...previous,
            combatLog: [...previous.combatLog, lootLogEntry(claimed, characterId)].slice(
              -MAX_COMBAT_LOG,
            ),
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

  attack(targetId: string): boolean {
    const sent = this.client?.sendBasicAttack(targetId) ?? false;
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

  sendChat(text: string): boolean {
    return this.client?.sendChat(text) ?? false;
  }

  rejoin(): void {
    if (this.client === null) {
      this.start();
      return;
    }
    this.updateState((previous) => ({
      ...previous,
      status: 'connecting',
      detail: '正在重新加入世界',
      notice: null,
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
    }));
  }

  async dispose(): Promise<void> {
    this.removeDebugHooks();
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

  private handleTransfer(mapId: string): void {
    this.updateState((previous) => ({
      ...previous,
      status: 'connecting',
      detail: '正在前往新的地图',
      mapId,
      players: [],
      monsters: [],
      loot: [],
      messages: [],
      roomPlayerCount: 0,
      combatProfile: null,
      combatLog: [],
      selectedTargetId: null,
      skillCooldowns: {},
      levelUpNotice: null,
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
      castSkill: (skillId, targetId) => this.castSkill(skillId, targetId),
      monsterScreenPoint: (monsterId) => this.bridge.monsterScreenPoint(monsterId),
      pickupDrop: (dropId) => this.pickup(dropId),
      equipItem: (itemId) => this.equip(itemId),
      unequipSlot: (slot) => this.unequip(slot),
      useItem: (itemId) => this.consumeItem(itemId),
      lootDrops: () => this.latestLoot,
      lootScreenPoint: (dropId) => this.bridge.lootScreenPoint(dropId),
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
  pickup: (dropId: string) => boolean;
  equip: (itemId: string) => boolean;
  unequip: (slot: EquipmentSlot) => boolean;
  consumeItem: (itemId: string) => boolean;
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

  return {
    state,
    rejoin,
    sendChat,
    castSkill,
    selectTarget,
    attack,
    pickup,
    equip,
    unequip,
    consumeItem,
  };
}
