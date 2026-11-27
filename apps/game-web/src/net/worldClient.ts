import { Client, type Room } from '@colyseus/sdk';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  CLIENT_MESSAGES,
  PROTOCOL_VERSION,
  SERVER_MESSAGES,
  assetResultSchema,
  characterProgressSchema,
  chatMessageSchema,
  combatEventSchema,
  combatProfileSchema,
  combatTargetChangedSchema,
  commandAckSchema,
  commandRejectedSchema,
  inventorySnapshotSchema,
  levelUpSchema,
  lootClaimedSchema,
  monsterStateKindFromCode,
  partyInviteViewSchema,
  partySnapshotSchema,
  questNavigationSchema,
  questSnapshotSchema,
  questUpdateSchema,
  sessionKickedSchema,
  sessionTransferSchema,
  shopCatalogSchema,
  systemNoticeSchema,
  worldRoomNameFor,
  type AssetResult,
  type CharacterProgress,
  type ChatMessage,
  type CombatEvent,
  type CombatProfile,
  type CombatTargetChanged,
  type CommandAck,
  type CommandRejected,
  type EquipmentSlot,
  type InventorySnapshot,
  type LevelUp,
  type LootClaimed,
  type MonsterStateKind,
  type PartyInviteView,
  type PartySnapshot,
  type QuestNavigation,
  type QuestNavigationPurpose,
  type QuestSnapshot,
  type QuestUpdate,
  type SessionKicked,
  type ShopCatalog,
  type SystemNotice,
  type TilePoint,
} from '@web-legend/contracts';
import { WorldState, type WorldStateInstance } from '@web-legend/contracts/world-state';

import { ApiError } from '../api/client';
import { createUuid } from '../lib/uuid';
import {
  clearReconnectToken,
  readReconnectToken,
  storeReconnectToken,
  type RoomPreference,
} from '../lib/identity';

export type ConnectionStatus =
  'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

export type PlayerView = {
  playerId: string;
  displayName: string;
  x: number;
  y: number;
  facing: number;
  moving: boolean;
  connected: boolean;
  alive: boolean;
  classId: string;
  level: number;
  colorIndex: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
};

export type MonsterView = {
  monsterId: string;
  templateId: string;
  displayName: string;
  level: number;
  x: number;
  y: number;
  facing: number;
  moving: boolean;
  hp: number;
  maxHp: number;
  state: MonsterStateKind;
  boss: boolean;
  enraged: boolean;
};

export type LootView = {
  dropId: string;
  itemId: string;
  templateId: string;
  displayName: string;
  quantity: number;
  x: number;
  y: number;
  ownerId: string;
  expiresAt: number;
};

export type WorldSnapshot = {
  mapId: string;
  instanceId: string;
  tick: number;
  playerCount: number;
  players: PlayerView[];
  monsters: MonsterView[];
  loot: LootView[];
};

export type WorldClientCallbacks = {
  onSnapshot: (snapshot: WorldSnapshot) => void;
  onStatus: (status: ConnectionStatus, detail: string) => void;
  onRoom: (roomId: string) => void;
  onAck: (ack: CommandAck) => void;
  onRejected: (rejected: CommandRejected) => void;
  onChat: (message: ChatMessage) => void;
  onCombatProfile: (profile: CombatProfile) => void;
  onCombatEvent: (event: CombatEvent) => void;
  onCombatTargetChanged: (state: CombatTargetChanged) => void;
  onTransfer: (mapId: string) => void;
  onLatency: (latencyMs: number) => void;
  onInventory: (snapshot: InventorySnapshot) => void;
  onShopCatalog: (catalog: ShopCatalog) => void;
  onQuestSnapshot: (snapshot: QuestSnapshot) => void;
  onQuestUpdate: (update: QuestUpdate) => void;
  onQuestNavigation: (navigation: QuestNavigation) => void;
  onPartySnapshot: (snapshot: PartySnapshot) => void;
  onPartyInvite: (invite: PartyInviteView) => void;
  onAssetResult: (result: AssetResult) => void;
  onProgress: (progress: CharacterProgress) => void;
  onLevelUp: (levelUp: LevelUp) => void;
  onLootClaimed: (claimed: LootClaimed) => void;
  onSystemNotice: (notice: SystemNotice) => void;
  onKicked: (notice: SessionKicked) => void;
};

export type WorldClientOptions = {
  url: string;
  characterId: string;
  /** Persisted map of the selected character; the server must agree. */
  mapId: string;
  /** Fetches a fresh one-time ticket from the Control API for every new join. */
  requestTicket: () => Promise<string>;
  roomPreference?: RoomPreference;
  /** Development-only: create a new room for every transfer (see identity.ts). */
  freshTransfers?: boolean;
  callbacks: WorldClientCallbacks;
};

type WorldRoom = Room<unknown, WorldStateInstance>;

const PING_INTERVAL_MS = 3_000;

function readStringField(value: unknown, field: string): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate: unknown = Object.getOwnPropertyDescriptor(value, field)?.value;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function joinErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  const serverMessage = readStringField(error, 'message');
  if (serverMessage !== null) {
    return `无法进入世界：${serverMessage}`;
  }

  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  if (code === 525) {
    return '无法进入世界：登录凭证无效，或该角色已在其他窗口游戏';
  }
  if (code === 520 || code === 524) {
    return '无法进入世界：服务器尚未准备好';
  }
  return '连接失败，请稍后重新加入';
}

/**
 * Colyseus client wrapper. It renders schema state for React and the Phaser
 * scene, submits intent-only `move.to` and chat commands, and follows the
 * server's map-transfer instruction by fetching a fresh ticket and joining the
 * target map room. It never chooses an authoritative position or map.
 */
export class WorldClient {
  private readonly options: WorldClientOptions;
  private room: WorldRoom | null = null;
  private mapId: string;
  private sequence = 0;
  private stopped = false;
  private transferring = false;
  private pingTimer: number | null = null;
  private readonly unsubscribers: (() => void)[] = [];

  constructor(options: WorldClientOptions) {
    this.options = options;
    this.mapId = options.mapId;
  }

  get characterId(): string {
    return this.options.characterId;
  }

  get currentMapId(): string {
    return this.mapId;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.options.callbacks.onStatus('connecting', '正在验证身份');
    const client = new Client(this.options.url);

    const token = readReconnectToken(this.options.characterId);
    if (token !== null) {
      try {
        const room = (await client.reconnect(token, WorldState)) as WorldRoom;
        if (this.stopped) {
          await room.leave();
          return;
        }
        this.attach(room);
        return;
      } catch {
        clearReconnectToken();
      }
    }

    await this.joinFresh(this.options.roomPreference ?? { mode: 'joinOrCreate' });
  }

  sendMove(target: TilePoint): boolean {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return false;
    }

    const commandId = createUuid();
    room.send(CLIENT_MESSAGES.moveTo, {
      protocolVersion: PROTOCOL_VERSION,
      commandId,
      clientSequence: this.sequence,
      targetTileX: target.x,
      targetTileY: target.y,
    });
    this.sequence += 1;
    return true;
  }

  sendBasicAttack(targetId: string): boolean {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return false;
    }
    room.send(CLIENT_MESSAGES.combatBasicAttack, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: createUuid(),
      clientSequence: this.sequence,
      targetId,
    });
    this.sequence += 1;
    return true;
  }

  /** Locks a visible target; the server approaches and swings on its own. */
  sendEngage(targetId: string): boolean {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return false;
    }
    room.send(CLIENT_MESSAGES.combatEngage, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: createUuid(),
      clientSequence: this.sequence,
      targetId,
    });
    this.sequence += 1;
    return true;
  }

  sendAutoAttackStart(targetId?: string): boolean {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return false;
    }
    room.send(CLIENT_MESSAGES.combatAutoAttackStart, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: createUuid(),
      clientSequence: this.sequence,
      ...(targetId === undefined ? {} : { targetId }),
    });
    this.sequence += 1;
    return true;
  }

  sendAutoAttackStop(): boolean {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return false;
    }
    room.send(CLIENT_MESSAGES.combatAutoAttackStop, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: createUuid(),
      clientSequence: this.sequence,
    });
    this.sequence += 1;
    return true;
  }

  sendSkill(skillId: string, targetId: string): boolean {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return false;
    }
    room.send(CLIENT_MESSAGES.skillCast, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: createUuid(),
      clientSequence: this.sequence,
      skillId,
      targetId,
    });
    this.sequence += 1;
    return true;
  }

  sendPickup(dropId: string): boolean {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return false;
    }
    room.send(CLIENT_MESSAGES.lootPickup, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: createUuid(),
      clientSequence: this.sequence,
      dropId,
    });
    this.sequence += 1;
    return true;
  }

  sendEquip(itemId: string): boolean {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return false;
    }
    room.send(CLIENT_MESSAGES.inventoryEquip, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: createUuid(),
      clientSequence: this.sequence,
      itemId,
    });
    this.sequence += 1;
    return true;
  }

  sendUnequip(slot: EquipmentSlot): boolean {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return false;
    }
    room.send(CLIENT_MESSAGES.inventoryUnequip, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: createUuid(),
      clientSequence: this.sequence,
      slot,
    });
    this.sequence += 1;
    return true;
  }

  sendUse(itemId: string): boolean {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return false;
    }
    room.send(CLIENT_MESSAGES.inventoryUse, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: createUuid(),
      clientSequence: this.sequence,
      itemId,
    });
    this.sequence += 1;
    return true;
  }

  sendShopBuy(merchantId: string, templateId: string, quantity: number): boolean {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return false;
    }
    room.send(CLIENT_MESSAGES.shopBuy, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: createUuid(),
      clientSequence: this.sequence,
      merchantId,
      templateId,
      quantity,
    });
    this.sequence += 1;
    return true;
  }

  sendShopSell(merchantId: string, itemId: string, quantity: number): boolean {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return false;
    }
    room.send(CLIENT_MESSAGES.shopSell, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: createUuid(),
      clientSequence: this.sequence,
      merchantId,
      itemId,
      quantity,
    });
    this.sequence += 1;
    return true;
  }

  sendQuestAccept(questId: string): boolean {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return false;
    }
    room.send(CLIENT_MESSAGES.questAccept, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: createUuid(),
      clientSequence: this.sequence,
      questId,
    });
    this.sequence += 1;
    return true;
  }

  sendQuestClaim(questId: string): boolean {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return false;
    }
    room.send(CLIENT_MESSAGES.questClaim, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: createUuid(),
      clientSequence: this.sequence,
      questId,
    });
    this.sequence += 1;
    return true;
  }

  /** Returns the command id, or null when the room cannot accept the intent. */
  sendQuestNavigate(questId: string, purpose: QuestNavigationPurpose): string | null {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return null;
    }
    const commandId = createUuid();
    room.send(CLIENT_MESSAGES.questNavigate, {
      protocolVersion: PROTOCOL_VERSION,
      commandId,
      clientSequence: this.sequence,
      questId,
      purpose,
    });
    this.sequence += 1;
    return commandId;
  }

  sendPartyInvite(targetPlayerId: string): boolean {
    return this.sendPartyCommand(CLIENT_MESSAGES.partyInvite, { targetPlayerId });
  }

  sendPartyAccept(inviteId: string): boolean {
    return this.sendPartyCommand(CLIENT_MESSAGES.partyAccept, { inviteId });
  }

  sendPartyDecline(inviteId: string): boolean {
    return this.sendPartyCommand(CLIENT_MESSAGES.partyDecline, { inviteId });
  }

  sendPartyLeave(): boolean {
    return this.sendPartyCommand(CLIENT_MESSAGES.partyLeave, {});
  }

  private sendPartyCommand(kind: string, fields: Record<string, string>): boolean {
    const room = this.room;
    if (room === null || this.stopped || this.transferring) {
      return false;
    }
    room.send(kind, {
      protocolVersion: PROTOCOL_VERSION,
      commandId: createUuid(),
      clientSequence: this.sequence,
      ...fields,
    });
    this.sequence += 1;
    return true;
  }

  sendChat(text: string): boolean {
    const room = this.room;
    const message = text.trim();
    if (
      room === null ||
      this.stopped ||
      this.transferring ||
      message.length === 0 ||
      message.length > CHAT_MESSAGE_MAX_LENGTH
    ) {
      return false;
    }

    room.send(CLIENT_MESSAGES.chatSend, {
      protocolVersion: PROTOCOL_VERSION,
      clientMessageId: createUuid(),
      message,
    });
    return true;
  }

  /** Follows a server-issued `session.transfer`: leave and join the target map. */
  async transferTo(mapId: string): Promise<void> {
    if (this.stopped || this.transferring) {
      return;
    }
    this.transferring = true;
    this.options.callbacks.onStatus('connecting', '正在前往新的地图');

    await this.detachCurrentRoom();
    clearReconnectToken();
    this.mapId = mapId;

    try {
      // The destination is fixed by the server; a development room preference
      // must not send the character back to the previous room. Automation can
      // opt into a fresh destination instance so its combat never competes
      // with another scenario in the shared wilds room.
      await this.joinFresh(
        this.options.freshTransfers === true ? { mode: 'create' } : { mode: 'joinOrCreate' },
      );
    } finally {
      this.transferring = false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearPingTimer();

    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }

    const room = this.room;
    this.room = null;

    if (room !== null) {
      try {
        await room.leave();
      } catch {
        // The socket may already be closed.
      }
      clearReconnectToken();
    }
  }

  /** Development-only: drop the socket to exercise the real reconnect path. */
  dropConnection(): boolean {
    if (this.room === null) {
      return false;
    }
    this.room.connection.close();
    return true;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private async joinFresh(preference: RoomPreference): Promise<void> {
    const client = new Client(this.options.url);
    try {
      const ticket = await this.options.requestTicket();
      if (this.stopped) {
        return;
      }

      this.options.callbacks.onStatus('connecting', '正在连接世界');
      const joinOptions = { protocolVersion: PROTOCOL_VERSION, ticket };
      const roomName = worldRoomNameFor(this.mapId);

      const joined =
        preference.mode === 'create'
          ? client.create(roomName, joinOptions, WorldState)
          : preference.mode === 'joinById'
            ? client.joinById(preference.roomId, joinOptions, WorldState)
            : client.joinOrCreate(roomName, joinOptions, WorldState);
      const room = (await joined) as WorldRoom;

      if (this.stopped) {
        await room.leave();
        return;
      }
      this.attach(room);
    } catch (error) {
      if (!this.stopped) {
        this.options.callbacks.onStatus('failed', joinErrorMessage(error));
      }
    }
  }

  private async detachCurrentRoom(): Promise<void> {
    this.clearPingTimer();
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
    const room = this.room;
    this.room = null;
    if (room !== null) {
      try {
        await room.leave();
      } catch {
        // Leaving a room whose socket already closed is harmless.
      }
    }
  }

  private attach(room: WorldRoom): void {
    this.room = room;
    this.sequence = 0;
    // The SDK otherwise refuses to reconnect during a room's first few seconds,
    // which would turn an early network blip into a permanent leave.
    room.reconnection.minUptime = 0;
    this.options.callbacks.onRoom(room.roomId);
    this.options.callbacks.onStatus('connected', `房间 ${room.roomId} · ${this.mapId}`);
    storeReconnectToken(this.options.characterId, room.reconnectionToken);

    const handleStateChange = (state: WorldStateInstance): void => {
      this.emitSnapshot(state);
    };
    room.onStateChange(handleStateChange);
    this.unsubscribers.push(() => {
      room.onStateChange.remove(handleStateChange);
    });

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.commandAck, (payload: unknown) => {
        const parsed = commandAckSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onAck(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.commandRejected, (payload: unknown) => {
        const parsed = commandRejectedSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onRejected(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.chatMessage, (payload: unknown) => {
        const parsed = chatMessageSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onChat(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.combatProfile, (payload: unknown) => {
        const parsed = combatProfileSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onCombatProfile(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.combatEvent, (payload: unknown) => {
        const parsed = combatEventSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onCombatEvent(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.combatTargetChanged, (payload: unknown) => {
        const parsed = combatTargetChangedSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onCombatTargetChanged(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.inventorySnapshot, (payload: unknown) => {
        const parsed = inventorySnapshotSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onInventory(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.shopCatalog, (payload: unknown) => {
        const parsed = shopCatalogSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onShopCatalog(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.questSnapshot, (payload: unknown) => {
        const parsed = questSnapshotSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onQuestSnapshot(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.questUpdate, (payload: unknown) => {
        const parsed = questUpdateSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onQuestUpdate(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.questNavigation, (payload: unknown) => {
        const parsed = questNavigationSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onQuestNavigation(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.partySnapshot, (payload: unknown) => {
        const parsed = partySnapshotSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onPartySnapshot(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.partyInvite, (payload: unknown) => {
        const parsed = partyInviteViewSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onPartyInvite(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.assetResult, (payload: unknown) => {
        const parsed = assetResultSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onAssetResult(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.characterProgress, (payload: unknown) => {
        const parsed = characterProgressSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onProgress(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.characterLevelUp, (payload: unknown) => {
        const parsed = levelUpSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onLevelUp(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.lootClaimed, (payload: unknown) => {
        const parsed = lootClaimedSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onLootClaimed(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.systemNotice, (payload: unknown) => {
        const parsed = systemNoticeSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onSystemNotice(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.sessionKicked, (payload: unknown) => {
        const parsed = sessionKickedSchema.safeParse(payload);
        if (parsed.success) {
          this.options.callbacks.onKicked(parsed.data);
        }
      }),
    );

    this.unsubscribers.push(
      room.onMessage(SERVER_MESSAGES.sessionTransfer, (payload: unknown) => {
        const parsed = sessionTransferSchema.safeParse(payload);
        if (!parsed.success || this.transferring) {
          return;
        }
        this.options.callbacks.onTransfer(parsed.data.mapId);
      }),
    );

    const handleDrop = (): void => {
      this.options.callbacks.onStatus('reconnecting', '网络中断，正在重连');
    };
    room.onDrop(handleDrop);
    this.unsubscribers.push(() => {
      room.onDrop.remove(handleDrop);
    });

    const handleReconnect = (): void => {
      storeReconnectToken(this.options.characterId, room.reconnectionToken);
      this.options.callbacks.onStatus('connected', `房间 ${room.roomId} · ${this.mapId}`);
    };
    room.onReconnect(handleReconnect);
    this.unsubscribers.push(() => {
      room.onReconnect.remove(handleReconnect);
    });

    const handleLeave = (code: number): void => {
      this.clearPingTimer();
      clearReconnectToken();
      if (code === 4000) {
        this.options.callbacks.onStatus('disconnected', '已离开世界');
      } else {
        this.options.callbacks.onStatus('failed', '与服务器的连接已断开');
      }
    };
    room.onLeave(handleLeave);
    this.unsubscribers.push(() => {
      room.onLeave.remove(handleLeave);
    });

    this.clearPingTimer();
    this.pingTimer = window.setInterval(() => {
      try {
        room.ping((latencyMs) => {
          this.options.callbacks.onLatency(Math.round(latencyMs));
        });
      } catch {
        this.clearPingTimer();
      }
    }, PING_INTERVAL_MS);

    room.ping((latencyMs) => {
      this.options.callbacks.onLatency(Math.round(latencyMs));
    });
  }

  private emitSnapshot(state: WorldStateInstance): void {
    const players: PlayerView[] = [];
    state.players.forEach((player) => {
      players.push({
        playerId: player.playerId,
        displayName: player.displayName,
        x: player.x,
        y: player.y,
        facing: player.facing,
        moving: player.moving,
        connected: player.connected,
        alive: player.alive,
        classId: player.classId,
        level: player.level,
        colorIndex: player.colorIndex,
        hp: player.hp,
        maxHp: player.maxHp,
        mp: player.mp,
        maxMp: player.maxMp,
      });
    });

    const monsters: MonsterView[] = [];
    state.monsters.forEach((monster) => {
      monsters.push({
        monsterId: monster.monsterId,
        templateId: monster.templateId,
        displayName: monster.displayName,
        level: monster.level,
        x: monster.x,
        y: monster.y,
        facing: monster.facing,
        moving: monster.moving,
        hp: monster.hp,
        maxHp: monster.maxHp,
        state: monsterStateKindFromCode(monster.state),
        boss: monster.boss,
        enraged: monster.enraged,
      });
    });

    const loot: LootView[] = [];
    state.loot.forEach((drop) => {
      loot.push({
        dropId: drop.dropId,
        itemId: drop.itemId,
        templateId: drop.templateId,
        displayName: drop.displayName,
        quantity: drop.quantity,
        x: drop.x,
        y: drop.y,
        ownerId: drop.ownerId,
        expiresAt: drop.expiresAt,
      });
    });

    this.options.callbacks.onSnapshot({
      mapId: state.mapId,
      instanceId: state.instanceId,
      tick: state.serverTick,
      playerCount: state.playerCount,
      players,
      monsters,
      loot,
    });
  }

  private clearPingTimer(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
