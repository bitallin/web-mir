import { CloseCode, ErrorCode, Room, ServerError, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { hashToken } from '@web-legend/auth';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  CLIENT_MESSAGES,
  COMMAND_REJECTION_MESSAGES,
  DEFAULT_PATCH_RATE_MS,
  DEFAULT_TICK_HZ,
  FACING,
  MONSTER_STATE_CODES,
  PICKUP_RANGE_TILES,
  PLAYER_SPEED_UNITS_PER_SECOND,
  PROTOCOL_VERSION,
  SERVER_MESSAGES,
  TILE_UNITS,
  assetResultSchema,
  characterClassSchema,
  characterProgressSchema,
  chatMessageSchema,
  chatSendSchema,
  combatBasicAttackSchema,
  combatEventSchema,
  combatProfileSchema,
  commandAckSchema,
  commandRejectedSchema,
  sessionKickedSchema,
  inventoryEquipSchema,
  inventorySnapshotSchema,
  inventoryUnequipSchema,
  inventoryUseSchema,
  levelUpSchema,
  lootClaimedSchema,
  lootPickupSchema,
  moveToCommandSchema,
  sessionTransferSchema,
  skillCastSchema,
  systemNoticeSchema,
  tilePointSchema,
  worldJoinOptionsSchema,
  type AdminCommandEnvelope,
  type AdminRoom,
  type AssetCommandKind,
  type AssetResult,
  type CharacterProgress,
  type ChatMessage,
  type CombatEvent,
  type CombatEventPayload,
  type CombatProfile,
  type CommandAck,
  type CommandRejected,
  type CommandRejectionCode,
  type Facing,
  type InventorySnapshot,
  type LevelUp,
  type MapMonsterSpawn,
  type MapPortal,
  type SessionTransfer,
  type SystemNotice,
  type TilePoint,
} from '@web-legend/contracts';
import {
  LootState,
  MonsterState,
  PlayerState,
  WorldState,
  type LootStateInstance,
  type MonsterStateInstance,
  type PlayerStateInstance,
  type WorldStateInstance,
} from '@web-legend/contracts/world-state';
import {
  AssetError,
  AssetService,
  type KillRewardInput,
  type KillRewardOutcome,
  type LoadedAssets,
  type LootDropView,
} from '@web-legend/game-application';
import {
  CombatWorld,
  defaultChatFilter,
  type ChatFilter,
  type CombatCommandResult,
  type CombatStats,
} from '@web-legend/game-domain';
import {
  DEFAULT_INTEREST,
  InterestManager,
  createFixedStepRunner,
  findPath,
  tileOfUnits,
  WorldSimulation,
  type FixedStepRunner,
} from '@web-legend/game-simulation';
import {
  acquireCharacterLease,
  consumeGameTicket,
  findAccountById,
  findCharacterById,
  findRealmById,
  refreshCharacterLeases,
  releaseCharacterLease,
  saveCharacterCheckpoint,
  saveCharacterTransfer,
  type Database,
} from '@web-legend/persistence';
import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { AdminCommandHub } from '../admin/commandHub';
import type { MetricsRegistry, RoomMetrics } from '../metrics';
import { createCombatRng } from '../world/combatRng';
import { BASE_ROOM_CONTENT, type ContentProvider, type RoomContent } from '../world/contentStore';
import type { MapInstance } from '../world/mapRegistry';
import { createTokenBucket, type TokenBucket } from '../world/rateLimiter';

export type WorldMapRoomOptions = {
  database: Database;
  serverId: string;
  logger: Logger;
  metrics: MetricsRegistry;
  mapInstance: MapInstance;
  /** Fixed content snapshot source; omitted in unit fixtures means baseline. */
  contentStore?: ContentProvider;
  adminHub?: AdminCommandHub;
  /** Realm this process serves; characters from other realms are rejected. */
  realmCode?: string;
  /** Overrides the compiled map's monster spawns; tests use an empty list. */
  monsterSpawns?: readonly MapMonsterSpawn[];
  tickHz?: number;
  patchRateMs?: number;
  reconnectGraceSeconds?: number;
  commandRateCapacity?: number;
  commandRateRefillPerSecond?: number;
  chatRateCapacity?: number;
  chatRateRefillPerSecond?: number;
  /** Replaces the built-in moderation rules; tests inject a narrow rule set. */
  chatFilter?: ChatFilter;
  checkpointIntervalMs?: number;
  interestCellSize?: number;
  interestRadiusCells?: number;
  /** Deterministic in tests; production defaults to a crypto-seeded RNG. */
  combatRng?: () => number;
  /** Deterministic in tests; production defaults to Math.random for loot. */
  economyRng?: () => number;
  monsterRespawnMs?: number;
  playerRespawnMs?: number;
};

const DEFAULT_RECONNECT_GRACE_SECONDS = 15;
const DEFAULT_COMMAND_RATE_CAPACITY = 10;
const DEFAULT_COMMAND_RATE_REFILL_PER_SECOND = 10;
const DEFAULT_CHAT_RATE_CAPACITY = 4;
const DEFAULT_CHAT_RATE_REFILL_PER_SECOND = 2;
const DEFAULT_CHECKPOINT_INTERVAL_MS = 20_000;
const RECENT_COMMAND_WINDOW = 32;
const RECENT_CHAT_WINDOW = 32;
const COLOR_COUNT = 6;
const LOOT_EXPIRY_CHECK_TICKS = 20;
const REWARD_RETRY_ATTEMPTS = 3;

/**
 * Leases outlive a single tick and are refreshed in the background. A crashed
 * process releases control automatically once its lease expires.
 */
const LEASE_DURATION_MS = 30_000;
const LEASE_REFRESH_INTERVAL_MS = 10_000;

const authDataSchema = z.object({
  accountId: z.uuid(),
  characterId: z.uuid(),
  realmId: z.uuid(),
  displayName: z.string().min(1).max(32),
  classId: characterClassSchema,
  level: z.number().int().min(1),
  mapId: z.string().min(1),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  facing: z.number().int().min(0).max(3),
  hp: z.number().int().nonnegative(),
  maxHp: z.number().int().positive(),
  mp: z.number().int().nonnegative(),
  maxMp: z.number().int().nonnegative(),
  /** Epoch ms while a moderator mute is active; null when unmuted. */
  mutedUntil: z.number().int().nonnegative().nullable(),
});

type WorldAuthData = z.infer<typeof authDataSchema>;

type SessionRecord = {
  client: Client;
  playerId: string;
  accountId: string;
  displayName: string;
  mutedUntil: number | null;
  lastSequence: number;
  recentAcks: Map<string, CommandAck>;
  rateBucket: TokenBucket;
  chatBucket: TokenBucket;
  recentChatIds: Set<string>;
  recentCombat: Map<string, CombatEvent[]>;
  recentAssets: Map<string, AssetCommandKind>;
  /** Last committed private asset state, merged with live vitals on send. */
  assetSnapshot: InventorySnapshot;
  hp: number;
  mp: number;
  transferring: boolean;
  transferTargetMapId: string | null;
  checkpointing: boolean;
  lastCheckpointAt: number;
  view: StateView;
  visible: Set<string>;
};

function colorIndexFor(characterId: string): number {
  let hash = 0;
  for (const char of characterId) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
  }
  return hash % COLOR_COUNT;
}

function toFacing(value: number): Facing {
  switch (value) {
    case FACING.north:
      return FACING.north;
    case FACING.east:
      return FACING.east;
    case FACING.west:
      return FACING.west;
    default:
      return FACING.south;
  }
}

function extractCommandMeta(raw: unknown): { commandId?: string; clientSequence?: number } {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const record = raw as Record<string, unknown>;
  const meta: { commandId?: string; clientSequence?: number } = {};
  if (typeof record['commandId'] === 'string' && z.uuid().safeParse(record['commandId']).success) {
    meta.commandId = record['commandId'];
  }
  const sequence = record['clientSequence'];
  if (typeof sequence === 'number' && Number.isInteger(sequence) && sequence >= 0) {
    meta.clientSequence = sequence;
  }
  return meta;
}

function tileCenter(tile: TilePoint): { x: number; y: number } {
  return {
    x: tile.x * TILE_UNITS + TILE_UNITS / 2,
    y: tile.y * TILE_UNITS + TILE_UNITS / 2,
  };
}

/** `ws` emits Buffer, ArrayBuffer or a list of fragments depending on framing. */
function payloadByteLength(data: unknown): number {
  if (typeof data === 'string') {
    return Buffer.byteLength(data, 'utf8');
  }
  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }
  if (ArrayBuffer.isView(data)) {
    return data.byteLength;
  }
  if (Array.isArray(data)) {
    let total = 0;
    for (const chunk of data) {
      total += payloadByteLength(chunk);
    }
    return total;
  }
  return 0;
}

/**
 * One Colyseus room per map instance (ADR-003 / ADR-018). The room performs
 * connection adaptation only: ticket validation, lease acquisition, rate
 * limiting, routing, AOI filtering and state synchronization. Movement and
 * map rules live in `@web-legend/game-simulation` and `@web-legend/map-runtime`.
 */
export class WorldMapRoom extends Room<{ state: WorldStateInstance }> {
  override maxClients = 50;

  override state = new WorldState();

  private options!: WorldMapRoomOptions;
  private metrics!: RoomMetrics;
  private map!: MapInstance;
  private content!: RoomContent;
  private simulation!: WorldSimulation;
  private combat!: CombatWorld;
  private interest!: InterestManager;
  private runner!: FixedStepRunner;
  private assets!: AssetService;
  private tick = 0;
  private killSequence = 0;
  /** True while Colyseus is encoding and writing a state patch. */
  private patching = false;
  private assetQueue: Promise<void> = Promise.resolve();
  private checkpointIntervalMs = DEFAULT_CHECKPOINT_INTERVAL_MS;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sessionByPlayer = new Map<string, string>();
  private readonly pendingAssets = new Map<string, LoadedAssets>();

  override onCreate(options: WorldMapRoomOptions): void {
    this.options = options;
    this.map = options.mapInstance;
    // Snapshot once: an activation only affects rooms created afterwards.
    this.content = options.contentStore?.snapshot() ?? BASE_ROOM_CONTENT;
    this.simulation = new WorldSimulation(this.map.runtime.grid);
    this.interest = new InterestManager({
      cellSize: options.interestCellSize ?? DEFAULT_INTEREST.cellSize,
      radiusCells: options.interestRadiusCells ?? DEFAULT_INTEREST.radiusCells,
    });

    const respawnTile = this.map.runtime.manifest.spawnPoints[0];
    if (respawnTile === undefined) {
      throw new Error(`map "${this.map.mapId}" has no spawn point for combat respawn`);
    }
    this.combat = new CombatWorld({
      spawns: options.monsterSpawns ?? this.map.runtime.manifest.monsterSpawns,
      grid: this.map.runtime.grid,
      pathfinder: findPath,
      rng: options.combatRng ?? createCombatRng(),
      playerRespawnTile: respawnTile,
      content: this.content.bundle,
      // The immutable compiled map decides safe zones; client intent can never
      // change it (ADR-021).
      pvpEnabled: this.map.runtime.manifest.pvpMode === 'open',
      ...(options.monsterRespawnMs === undefined
        ? {}
        : { monsterRespawnMs: options.monsterRespawnMs }),
      ...(options.playerRespawnMs === undefined
        ? {}
        : { playerRespawnMs: options.playerRespawnMs }),
    });
    for (const monster of this.combat.listMonsters()) {
      const monsterState = new MonsterState();
      monsterState.monsterId = monster.id;
      monsterState.templateId = monster.templateId;
      monsterState.displayName = monster.displayName;
      monsterState.level = monster.level;
      monsterState.x = monster.x;
      monsterState.y = monster.y;
      monsterState.facing = monster.facing;
      monsterState.hp = monster.hp;
      monsterState.maxHp = monster.maxHp;
      monsterState.state = MONSTER_STATE_CODES[monster.state];
      this.state.monsters.set(monster.id, monsterState);
      this.interest.add(monster.id, tileOfUnits(monster));
    }

    this.assets = new AssetService(options.database, {
      content: this.content.bundle,
      ...(options.economyRng === undefined ? {} : { rng: options.economyRng }),
    });

    this.metrics = options.metrics.register(this.roomId, {
      mapId: this.map.mapId,
      instanceId: this.map.instanceId,
      contentVersion: this.content.version,
    });

    const tickHz = options.tickHz ?? DEFAULT_TICK_HZ;
    const patchRateMs = options.patchRateMs ?? DEFAULT_PATCH_RATE_MS;
    this.checkpointIntervalMs = options.checkpointIntervalMs ?? DEFAULT_CHECKPOINT_INTERVAL_MS;

    this.state.mapId = this.map.mapId;
    this.state.instanceId = this.map.instanceId;
    this.state.contentVersion = this.content.version;
    this.state.contentChecksum = this.content.checksum;
    this.state.tickHz = tickHz;
    this.state.speedUnitsPerSecond = PLAYER_SPEED_UNITS_PER_SECOND;
    this.setPatchRate(patchRateMs);

    // Patch writes happen synchronously inside broadcastPatch(), so a flag
    // around it lets the per-client byte counter separate patches from
    // ordinary messages without touching Colyseus internals.
    const broadcastPatch = this.broadcastPatch.bind(this);
    this.broadcastPatch = (): boolean => {
      this.patching = true;
      try {
        return broadcastPatch();
      } finally {
        this.patching = false;
      }
    };

    const stepMs = 1_000 / tickHz;
    this.runner = createFixedStepRunner({
      stepMs,
      maxCatchUpSteps: 5,
      onStep: () => {
        this.simulateTick();
      },
    });
    this.setSimulationInterval((deltaMs) => {
      this.runner.advance(deltaMs);
    }, stepMs);

    this.onMessage<unknown>(CLIENT_MESSAGES.moveTo, (client, message) => {
      this.handleMove(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.chatSend, (client, message) => {
      this.handleChat(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.combatBasicAttack, (client, message) => {
      this.handleBasicAttack(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.skillCast, (client, message) => {
      this.handleSkillCast(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.lootPickup, (client, message) => {
      this.handleLootPickup(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.inventoryEquip, (client, message) => {
      this.handleInventoryEquip(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.inventoryUnequip, (client, message) => {
      this.handleInventoryUnequip(client, message);
    });
    this.onMessage<unknown>(CLIENT_MESSAGES.inventoryUse, (client, message) => {
      this.handleInventoryUse(client, message);
    });

    this.clock.setInterval(() => {
      void this.refreshLeases();
    }, LEASE_REFRESH_INTERVAL_MS);
    this.clock.setInterval(() => {
      void this.checkpointAll();
    }, this.checkpointIntervalMs);

    options.adminHub?.register({
      roomId: this.roomId,
      snapshot: () => this.adminSnapshot(),
      apply: (command) => this.applyAdminCommand(command),
    });

    options.logger.info(
      {
        roomId: this.roomId,
        mapId: this.map.mapId,
        instanceId: this.map.instanceId,
        tickHz,
        patchRateMs,
        serverId: options.serverId,
        monsters: this.state.monsters.size,
      },
      'world map room created',
    );

    // Unclaimed drops survive a room restart because the item instance and its
    // world drop row are committed before the client is told about them.
    void this.restoreLoot();
  }

  override async onAuth(client: Client, rawOptions: unknown): Promise<WorldAuthData> {
    const parsed = worldJoinOptionsSchema.safeParse(rawOptions);
    if (!parsed.success) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '进入世界的凭证格式不正确');
    }
    if (parsed.data.protocolVersion !== PROTOCOL_VERSION) {
      throw new ServerError(
        ErrorCode.AUTH_FAILED,
        `Protocol version ${String(PROTOCOL_VERSION)} required`,
      );
    }

    try {
      return await this.authenticateTicket(client, parsed.data.ticket);
    } catch (error) {
      if (error instanceof ServerError) {
        throw error;
      }
      this.options.logger.error(
        { err: error, roomId: this.roomId, sessionId: client.sessionId },
        'game ticket validation failed',
      );
      throw new ServerError(ErrorCode.AUTH_FAILED, '身份校验服务暂不可用，请稍后重试');
    }
  }

  override onJoin(client: Client): void {
    this.instrumentClient(client);

    const auth = authDataSchema.parse(client.auth);
    if (this.sessionByPlayer.has(auth.characterId)) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '该角色正在另一台设备上游戏');
    }

    const loaded = this.pendingAssets.get(client.sessionId);
    this.pendingAssets.delete(client.sessionId);
    if (loaded === undefined) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '角色资产加载失败，请重新进入');
    }
    const snapshot = loaded.snapshot;

    // A character that was last checkpointed at 0 HP re-enters at a spawn point
    // with full vitals; combat never persists a dead character in place.
    const needsRevival = snapshot.hp <= 0;
    const spawn: { tile: TilePoint; position?: { x: number; y: number } } = needsRevival
      ? { tile: this.pickSpawnPoint() }
      : this.resolveSpawn(auth);
    this.simulation.addPlayer({
      id: auth.characterId,
      displayName: auth.displayName,
      spawn: spawn.tile,
      colorIndex: colorIndexFor(auth.characterId),
      ...(spawn.position === undefined ? {} : { position: spawn.position }),
      facing: toFacing(auth.facing),
    });

    const position = this.simulation.getPlayer(auth.characterId);
    try {
      this.combat.addPlayer({
        id: auth.characterId,
        displayName: auth.displayName,
        classId: auth.classId,
        level: snapshot.level,
        hp: needsRevival ? loaded.stats.maxHp : snapshot.hp,
        mp: needsRevival ? loaded.stats.maxMp : snapshot.mp,
        x: position?.x ?? 0,
        y: position?.y ?? 0,
        stats: loaded.stats,
      });
    } catch (error) {
      this.simulation.removePlayer(auth.characterId);
      this.options.logger.error(
        { err: error, roomId: this.roomId, characterId: auth.characterId },
        'failed to initialize combat state',
      );
      throw new ServerError(ErrorCode.AUTH_FAILED, '角色战斗状态初始化失败');
    }
    const combatPlayer = this.combat.getPlayer(auth.characterId);
    if (combatPlayer === undefined || position === undefined) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '角色战斗状态初始化失败');
    }

    const player = new PlayerState();
    player.playerId = auth.characterId;
    player.displayName = auth.displayName;
    player.classId = auth.classId;
    player.level = combatPlayer.level;
    player.colorIndex = colorIndexFor(auth.characterId);
    player.hp = combatPlayer.hp;
    player.maxHp = combatPlayer.maxHp;
    player.mp = combatPlayer.mp;
    player.maxMp = combatPlayer.maxMp;
    player.alive = combatPlayer.alive;
    player.x = position.x;
    player.y = position.y;
    player.facing = position.facing;
    this.state.players.set(auth.characterId, player);
    this.state.playerCount = this.state.players.size;

    const view = new StateView();
    const session: SessionRecord = {
      client,
      playerId: auth.characterId,
      accountId: auth.accountId,
      displayName: auth.displayName,
      mutedUntil: auth.mutedUntil,
      lastSequence: -1,
      recentAcks: new Map(),
      rateBucket: createTokenBucket({
        capacity: this.options.commandRateCapacity ?? DEFAULT_COMMAND_RATE_CAPACITY,
        refillPerSecond:
          this.options.commandRateRefillPerSecond ?? DEFAULT_COMMAND_RATE_REFILL_PER_SECOND,
        startMs: Date.now(),
      }),
      chatBucket: createTokenBucket({
        capacity: this.options.chatRateCapacity ?? DEFAULT_CHAT_RATE_CAPACITY,
        refillPerSecond:
          this.options.chatRateRefillPerSecond ?? DEFAULT_CHAT_RATE_REFILL_PER_SECOND,
        startMs: Date.now(),
      }),
      recentChatIds: new Set(),
      recentCombat: new Map(),
      recentAssets: new Map(),
      assetSnapshot: {
        ...snapshot,
        level: combatPlayer.level,
        hp: combatPlayer.hp,
        maxHp: combatPlayer.maxHp,
        mp: combatPlayer.mp,
        maxMp: combatPlayer.maxMp,
        attack: combatPlayer.attack,
        defense: combatPlayer.defense,
      },
      hp: combatPlayer.hp,
      mp: combatPlayer.mp,
      transferring: false,
      transferTargetMapId: null,
      checkpointing: false,
      lastCheckpointAt: Date.now(),
      view,
      visible: new Set(),
    };
    this.sessions.set(client.sessionId, session);
    this.sessionByPlayer.set(auth.characterId, client.sessionId);
    client.view = view;

    const affected = this.interest.add(auth.characterId, spawn.tile);
    this.refreshViews(affected);
    this.metrics.setPlayers(this.state.players.size);
    // Deferred so the profile is delivered after the join handshake; a message
    // sent inside onJoin can otherwise race the client's listener registration.
    this.clock.setTimeout(() => {
      const session = this.sessions.get(client.sessionId);
      if (session !== undefined) {
        this.sendProfile(session.client, session.playerId);
        this.sendAssetSnapshot(session.client, session);
        this.broadcastSystemNotice(
          'info',
          `${auth.displayName} 来到了 ${this.map.runtime.manifest.name}`,
        );
      }
    }, 50);

    this.metrics.recordWsConnection();
    this.options.logger.info(
      {
        roomId: this.roomId,
        mapId: this.map.mapId,
        characterId: auth.characterId,
        accountId: auth.accountId,
        spawn: spawn.tile,
        clients: this.state.players.size,
      },
      'player joined world',
    );
  }

  override onReconnect(client: Client): void {
    const session = this.sessions.get(client.sessionId);
    if (session === undefined) {
      return;
    }
    // The reconnected transport hands us a fresh Client; without reapplying
    // the wrappers its outbound bytes and inbound messages would be invisible.
    this.instrumentClient(client);
    this.metrics.recordWsReconnect();
    session.client = client;
    client.view = session.view;
    // A refreshed browser starts a fresh client with sequence 0; accepting its
    // commands again must not depend on the pre-refresh sequence counter.
    session.lastSequence = -1;
    session.recentAcks.clear();
    session.recentChatIds.clear();
    session.recentCombat.clear();
    this.setConnected(session.playerId, true);
    this.combat.setPlayerTargetable(session.playerId, true);
    this.clock.setTimeout(() => {
      const current = this.sessions.get(client.sessionId);
      if (current !== undefined) {
        this.sendProfile(current.client, current.playerId);
        this.sendAssetSnapshot(current.client, current);
      }
    }, 50);

    if (session.transferring && session.transferTargetMapId !== null) {
      this.sendTransfer(client, session.transferTargetMapId);
    }
    this.options.logger.info(
      { roomId: this.roomId, characterId: session.playerId },
      'player reconnected',
    );
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    this.pendingAssets.delete(client.sessionId);
    const session = this.sessions.get(client.sessionId);
    if (session === undefined) {
      return;
    }

    if (code === CloseCode.CONSENTED || session.transferring) {
      await this.removeSession(client.sessionId);
      return;
    }

    this.metrics.recordWsDisconnect();
    this.setConnected(session.playerId, false);
    this.simulation.clearPath(session.playerId);
    // A dropped player must not be killed by monsters during the grace window.
    this.combat.setPlayerTargetable(session.playerId, false);

    try {
      await this.allowReconnection(
        client,
        this.options.reconnectGraceSeconds ?? DEFAULT_RECONNECT_GRACE_SECONDS,
      );
      this.setConnected(session.playerId, true);
      this.combat.setPlayerTargetable(session.playerId, true);
    } catch {
      await this.removeSession(client.sessionId);
    }
  }

  /**
   * Bandwidth attribution is per client and transport-owned. Wrapping the raw
   * senders counts every patch and message; the raw socket's `message` event
   * yields the inbound payload size before Colyseus decodes it (ADR-024).
   */
  private instrumentClient(client: Client): void {
    const raw = client.raw.bind(client);
    client.raw = (data, options, callback) => {
      this.metrics.recordWsSent(data.byteLength, this.patching);
      raw(data, options, callback);
    };
    const enqueueRaw = client.enqueueRaw.bind(client);
    client.enqueueRaw = (data, options) => {
      this.metrics.recordWsSent(data.byteLength, this.patching);
      enqueueRaw(data, options);
    };
    client.ref.on('message', (data: unknown) => {
      this.metrics.recordWsReceived(payloadByteLength(data));
    });
  }

  override async onDispose(): Promise<void> {
    this.options.adminHub?.unregister(this.roomId);
    const sessionIds = [...this.sessions.keys()];
    await Promise.allSettled(sessionIds.map(async (sessionId) => this.removeSession(sessionId)));
    this.options.metrics.unregister(this.roomId);
    this.options.logger.info({ roomId: this.roomId }, 'world map room disposed');
  }

  private async authenticateTicket(client: Client, ticket: string): Promise<WorldAuthData> {
    const now = new Date();
    const consumed = await consumeGameTicket(
      this.options.database,
      hashToken(ticket),
      `${this.options.serverId}:${client.sessionId}`,
      now,
    );
    if (consumed === undefined) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '进入世界的票据无效或已过期，请重新进入');
    }

    const character = await findCharacterById(this.options.database, consumed.characterId);
    if (
      character === undefined ||
      character.accountId !== consumed.accountId ||
      character.realmId !== consumed.realmId
    ) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '角色信息无效，请重新登录');
    }

    const realm = await findRealmById(this.options.database, character.realmId);
    if (realm === undefined || realm.status !== 'active') {
      throw new ServerError(ErrorCode.AUTH_FAILED, '该区服当前不可进入');
    }
    if (this.options.realmCode !== undefined && realm.code !== this.options.realmCode) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '该角色不属于当前区服，请从对应区服进入');
    }

    // A ban persists on the account; an already-issued ticket cannot bypass it.
    const account = await findAccountById(this.options.database, character.accountId);
    if (account === undefined || account.status !== 'active') {
      throw new ServerError(ErrorCode.AUTH_FAILED, '该账号已被封禁');
    }
    const mutedUntil =
      account.mutedUntil !== null && account.mutedUntil.getTime() > now.getTime()
        ? account.mutedUntil.getTime()
        : null;

    // The ticket alone never chooses a map; the persisted character decides,
    // and the room only accepts players whose map matches its instance.
    if (character.mapId !== this.map.mapId) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '角色当前不在此地图，请重新进入');
    }

    const leaseAcquired = await acquireCharacterLease(this.options.database, {
      characterId: character.id,
      sessionId: client.sessionId,
      gameServerId: this.options.serverId,
      leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
      now,
    });
    if (!leaseAcquired) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '该角色正在另一台设备上游戏');
    }

    let assets: LoadedAssets;
    try {
      assets = await this.assets.loadAssets(character.id);
    } catch (error) {
      await releaseCharacterLease(this.options.database, character.id, client.sessionId).catch(
        () => undefined,
      );
      this.options.logger.error(
        { err: error, roomId: this.roomId, characterId: character.id },
        'failed to load character assets',
      );
      throw new ServerError(ErrorCode.AUTH_FAILED, '角色资产加载失败，请稍后重试');
    }
    this.pendingAssets.set(client.sessionId, assets);

    return {
      accountId: character.accountId,
      characterId: character.id,
      realmId: character.realmId,
      displayName: character.name,
      classId: character.classId,
      level: character.level,
      mapId: character.mapId,
      x: character.x,
      y: character.y,
      facing: character.facing,
      hp: character.hp,
      maxHp: character.maxHp,
      mp: character.mp,
      maxMp: character.maxMp,
      mutedUntil,
    };
  }

  private resolveSpawn(auth: WorldAuthData): {
    tile: TilePoint;
    position?: { x: number; y: number };
  } {
    if (auth.mapId === this.map.mapId) {
      const tile = tileOfUnits({ x: auth.x, y: auth.y });
      if (this.map.runtime.isStandable(tile)) {
        return { tile, position: { x: auth.x, y: auth.y } };
      }
      this.options.logger.warn(
        { roomId: this.roomId, characterId: auth.characterId, x: auth.x, y: auth.y },
        'stored character position is not walkable; using a spawn point',
      );
    }
    return { tile: this.pickSpawnPoint() };
  }

  private async refreshLeases(): Promise<void> {
    const sessionIds = [...this.sessions.keys()];
    if (sessionIds.length === 0) {
      return;
    }
    const now = new Date();
    try {
      await refreshCharacterLeases(
        this.options.database,
        sessionIds,
        new Date(now.getTime() + LEASE_DURATION_MS),
        now,
      );
    } catch (error) {
      this.options.logger.error(
        { err: error, roomId: this.roomId },
        'failed to refresh character leases',
      );
    }
  }

  /** Merged checkpoint: positions and HP/MP are saved at a throttled interval. */
  private async checkpointAll(): Promise<void> {
    const now = Date.now();
    await Promise.allSettled(
      [...this.sessions.values()].map(async (session) => {
        if (session.transferring || session.checkpointing) {
          return;
        }
        if (now - session.lastCheckpointAt < this.checkpointIntervalMs) {
          return;
        }
        const player = this.simulation.getPlayer(session.playerId);
        const combatPlayer = this.combat.getPlayer(session.playerId);
        if (player === undefined || combatPlayer === undefined) {
          return;
        }
        session.checkpointing = true;
        session.lastCheckpointAt = now;
        try {
          await saveCharacterCheckpoint(this.options.database, {
            characterId: session.playerId,
            x: player.x,
            y: player.y,
            facing: player.facing,
            hp: combatPlayer.hp,
            mp: combatPlayer.mp,
          });
        } catch (error) {
          this.options.logger.error(
            { err: error, roomId: this.roomId, characterId: session.playerId },
            'failed to checkpoint character position',
          );
        } finally {
          session.checkpointing = false;
        }
      }),
    );
  }

  private simulateTick(): void {
    const started = performance.now();
    this.state.serverTick = this.tick;
    this.tick += 1;

    const stepMs = 1_000 / this.state.tickHz;
    this.simulation.step(stepMs);

    const positions = new Map(
      this.simulation.listPlayers().map((player) => [player.id, { x: player.x, y: player.y }]),
    );
    const combatEvents = this.combat.step(stepMs, positions);
    this.applyCombatEvents(combatEvents);

    this.syncPlayers();
    this.syncMonsters();
    if (this.tick % LOOT_EXPIRY_CHECK_TICKS === 0) {
      this.expireLoot();
    }

    for (const player of this.simulation.listPlayers()) {
      const sessionId = this.sessionByPlayer.get(player.id);
      const session = sessionId === undefined ? undefined : this.sessions.get(sessionId);
      if (session === undefined || session.transferring) {
        continue;
      }
      if (this.combat.getPlayer(player.id)?.alive === false) {
        continue;
      }
      const portal = this.map.runtime.portalAt(tileOfUnits(player));
      if (portal !== undefined) {
        session.transferring = true;
        session.transferTargetMapId = portal.targetMapId;
        this.simulation.clearPath(player.id);
        void this.beginTransfer(session, portal, player);
      }
    }

    for (const player of this.simulation.listPlayers()) {
      const affected = this.interest.move(player.id, tileOfUnits(player));
      if (affected.length > 0) {
        this.refreshViews(affected);
      }
    }

    this.metrics.recordTick(performance.now() - started);
  }

  private applyCombatEvents(events: readonly CombatEventPayload[]): void {
    for (const event of events) {
      if (event.kind === 'death' && event.entityType === 'player') {
        this.simulation.clearPath(event.entityId);
      } else if (event.kind === 'respawn') {
        try {
          this.simulation.setPosition(event.entityId, { x: event.x, y: event.y });
        } catch (error) {
          this.options.logger.error(
            { err: error, roomId: this.roomId, characterId: event.entityId },
            'failed to move respawned player',
          );
        }
        const affected = this.interest.move(event.entityId, {
          x: Math.floor(event.x / TILE_UNITS),
          y: Math.floor(event.y / TILE_UNITS),
        });
        if (affected.length > 0) {
          this.refreshViews(affected);
        }
      }
    }

    this.recordCombatOutcomes(events);

    if (events.length === 0) {
      return;
    }
    const wireEvents = this.toWireEvents(events);
    for (const event of wireEvents) {
      this.broadcast(SERVER_MESSAGES.combatEvent, event);
    }
    this.metrics.recordCombatEvents(wireEvents.length);
  }

  private syncPlayers(): void {
    for (const player of this.simulation.listPlayers()) {
      const statePlayer = this.state.players.get(player.id);
      const combatPlayer = this.combat.getPlayer(player.id);
      if (statePlayer === undefined || combatPlayer === undefined) {
        continue;
      }
      statePlayer.x = player.x;
      statePlayer.y = player.y;
      statePlayer.facing = player.facing;
      statePlayer.level = combatPlayer.level;
      statePlayer.moving = combatPlayer.alive && player.moving;
      statePlayer.hp = combatPlayer.hp;
      statePlayer.maxHp = combatPlayer.maxHp;
      statePlayer.mp = combatPlayer.mp;
      statePlayer.maxMp = combatPlayer.maxMp;
      statePlayer.alive = combatPlayer.alive;

      const sessionId = this.sessionByPlayer.get(player.id);
      const session = sessionId === undefined ? undefined : this.sessions.get(sessionId);
      if (session !== undefined) {
        session.hp = combatPlayer.hp;
        session.mp = combatPlayer.mp;
      }
    }
  }

  private syncMonsters(): void {
    for (const monster of this.combat.listMonsters()) {
      const stateMonster = this.state.monsters.get(monster.id);
      if (stateMonster === undefined) {
        continue;
      }
      stateMonster.x = monster.x;
      stateMonster.y = monster.y;
      stateMonster.facing = monster.facing;
      stateMonster.hp = monster.hp;
      stateMonster.maxHp = monster.maxHp;
      stateMonster.moving = monster.moving;
      stateMonster.state = MONSTER_STATE_CODES[monster.state];

      const affected = this.interest.move(monster.id, tileOfUnits(monster));
      if (affected.length > 0) {
        this.refreshViews(affected);
      }
    }
  }

  /**
   * Applies AOI visibility to one player's Colyseus view. Only ids whose
   * visibility actually changed are written, so a tick with no cell crossing
   * produces no view operations.
   */
  private refreshViews(playerIds: readonly string[]): void {
    for (const playerId of new Set(playerIds)) {
      const sessionId = this.sessionByPlayer.get(playerId);
      if (sessionId === undefined) {
        continue;
      }
      const session = this.sessions.get(sessionId);
      if (session === undefined) {
        continue;
      }

      const desired = this.interest.visibleIdsFor(playerId);
      for (const visibleId of desired) {
        if (session.visible.has(visibleId)) {
          continue;
        }
        const entity = this.stateEntity(visibleId);
        if (entity !== undefined) {
          session.view.add(entity);
          session.visible.add(visibleId);
        }
      }
      for (const visibleId of [...session.visible]) {
        if (desired.has(visibleId)) {
          continue;
        }
        const entity = this.stateEntity(visibleId);
        if (entity !== undefined) {
          session.view.remove(entity);
        }
        session.visible.delete(visibleId);
      }
    }
  }

  private stateEntity(
    entityId: string,
  ): PlayerStateInstance | MonsterStateInstance | LootStateInstance | undefined {
    return (
      this.state.players.get(entityId) ??
      this.state.monsters.get(entityId) ??
      this.state.loot.get(entityId)
    );
  }

  private async beginTransfer(
    session: SessionRecord,
    portal: MapPortal,
    player: { facing: Facing },
  ): Promise<void> {
    const target = tileCenter(portal.targetTile);
    const combatPlayer = this.combat.getPlayer(session.playerId);
    try {
      await saveCharacterTransfer(this.options.database, {
        characterId: session.playerId,
        mapId: portal.targetMapId,
        x: target.x,
        y: target.y,
        facing: player.facing,
        hp: combatPlayer?.hp ?? session.hp,
        mp: combatPlayer?.mp ?? session.mp,
      });
      await releaseCharacterLease(
        this.options.database,
        session.playerId,
        session.client.sessionId,
      );
    } catch (error) {
      session.transferring = false;
      session.transferTargetMapId = null;
      this.options.logger.error(
        { err: error, roomId: this.roomId, characterId: session.playerId },
        'failed to persist map transfer',
      );
      return;
    }

    session.transferTargetMapId = portal.targetMapId;
    session.lastCheckpointAt = Date.now();

    // The target map is committed: remove the entity from this instance before
    // telling the browser to leave, so the character never exists twice.
    const affected = this.interest.remove(session.playerId);
    this.refreshViews(affected);
    this.simulation.removePlayer(session.playerId);
    this.combat.removePlayer(session.playerId);
    this.state.players.delete(session.playerId);
    this.state.playerCount = this.state.players.size;
    this.metrics.setPlayers(this.state.players.size);
    this.metrics.recordTransfer();
    this.sendTransfer(session.client, portal.targetMapId);

    this.options.logger.info(
      {
        roomId: this.roomId,
        characterId: session.playerId,
        fromMapId: this.map.mapId,
        toMapId: portal.targetMapId,
        portalId: portal.id,
      },
      'player transferred between maps',
    );
  }

  private sendTransfer(client: Client, mapId: string): void {
    const message: SessionTransfer = { mapId, serverTime: Date.now() };
    client.send(SERVER_MESSAGES.sessionTransfer, sessionTransferSchema.parse(message));
  }

  private handleMove(client: Client, raw: unknown): void {
    const session = this.sessions.get(client.sessionId);
    if (session === undefined) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
      return;
    }
    if (session.transferring) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_SESSION');
      return;
    }

    const parsed = moveToCommandSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }

    const command = parsed.data;
    if (command.protocolVersion !== PROTOCOL_VERSION) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'PROTOCOL_MISMATCH',
      );
      return;
    }

    const cached = session.recentAcks.get(command.commandId);
    if (cached !== undefined) {
      const replay: CommandAck = { ...cached, deduplicated: true, serverTime: Date.now() };
      client.send(SERVER_MESSAGES.commandAck, commandAckSchema.parse(replay));
      return;
    }

    if (command.clientSequence <= session.lastSequence) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'STALE_SEQUENCE',
      );
      return;
    }

    if (!session.rateBucket.take(Date.now())) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'RATE_LIMITED',
      );
      return;
    }

    const player = this.simulation.getPlayer(session.playerId);
    if (player === undefined) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'INVALID_SESSION',
      );
      return;
    }
    if (this.combat.getPlayer(session.playerId)?.alive === false) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'PLAYER_DEAD',
      );
      return;
    }

    const target: TilePoint = { x: command.targetTileX, y: command.targetTileY };
    if (!this.map.runtime.isWalkable(target.x, target.y)) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'INVALID_TARGET',
      );
      return;
    }

    const path = findPath(this.map.runtime.grid, tileOfUnits(player), target);
    if (path === null) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'UNREACHABLE',
      );
      return;
    }

    this.simulation.setPath(player.id, path);
    session.lastSequence = command.clientSequence;

    const ack: CommandAck = {
      commandId: command.commandId,
      clientSequence: command.clientSequence,
      serverTime: Date.now(),
      deduplicated: false,
      path,
      speedUnitsPerSecond: player.speedUnitsPerSecond,
      startX: player.x,
      startY: player.y,
    };

    session.recentAcks.set(command.commandId, ack);
    if (session.recentAcks.size > RECENT_COMMAND_WINDOW) {
      const oldest = session.recentAcks.keys().next();
      if (!oldest.done) {
        session.recentAcks.delete(oldest.value);
      }
    }

    client.send(SERVER_MESSAGES.commandAck, commandAckSchema.parse(ack));
    this.metrics.recordAcceptedCommand();
  }

  private handleBasicAttack(client: Client, raw: unknown): void {
    const parsed = combatBasicAttackSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    this.runCombatCommand(client, command, (playerId) =>
      this.combat.basicAttack(playerId, command.targetId),
    );
  }

  private handleSkillCast(client: Client, raw: unknown): void {
    const parsed = skillCastSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    this.runCombatCommand(client, command, (playerId) =>
      this.combat.castSkill(playerId, command.skillId, command.targetId),
    );
  }

  /**
   * Shared combat command pipeline: session/protocol validation, idempotent
   * replay, sequence and rate limits, then the authoritative domain call. A
   * duplicate command id resends the original events instead of re-rolling.
   */
  private runCombatCommand(
    client: Client,
    command: { commandId: string; clientSequence: number; protocolVersion: number },
    execute: (playerId: string) => CombatCommandResult,
  ): void {
    const session = this.sessions.get(client.sessionId);
    if (session === undefined) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
      return;
    }
    if (session.transferring) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'INVALID_SESSION',
      );
      return;
    }
    if (command.protocolVersion !== PROTOCOL_VERSION) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'PROTOCOL_MISMATCH',
      );
      return;
    }

    const cached = session.recentCombat.get(command.commandId);
    if (cached !== undefined) {
      for (const event of cached) {
        client.send(SERVER_MESSAGES.combatEvent, event);
      }
      return;
    }

    if (command.clientSequence <= session.lastSequence) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'STALE_SEQUENCE',
      );
      return;
    }
    if (!session.rateBucket.take(Date.now())) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'RATE_LIMITED',
      );
      return;
    }

    const result = execute(session.playerId);
    if (!result.accepted) {
      const rejection = result.rejection;
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        rejection?.code ?? 'INVALID_TARGET',
        {
          ...(rejection?.message === undefined ? {} : { message: rejection.message }),
          ...(rejection?.retryAfterMs === undefined
            ? {}
            : { retryAfterMs: rejection.retryAfterMs }),
        },
      );
      return;
    }

    session.lastSequence = command.clientSequence;
    const wireEvents = this.toWireEvents(result.events);
    session.recentCombat.set(command.commandId, wireEvents);
    if (session.recentCombat.size > RECENT_COMMAND_WINDOW) {
      const oldest = session.recentCombat.keys().next();
      if (!oldest.done) {
        session.recentCombat.delete(oldest.value);
      }
    }
    for (const event of wireEvents) {
      this.broadcast(SERVER_MESSAGES.combatEvent, event);
    }
    this.recordCombatOutcomes(result.events);
    this.metrics.recordCombatCommand();
    this.metrics.recordCombatEvents(wireEvents.length);
    this.metrics.recordAcceptedCommand();
  }

  private recordCombatOutcomes(events: readonly CombatEventPayload[]): void {
    for (const event of events) {
      if (event.kind !== 'death') {
        continue;
      }
      if (event.entityType === 'monster') {
        this.metrics.recordMonsterKill();
        this.scheduleKillReward(event);
        continue;
      }

      this.metrics.recordPlayerDeath();
      const victimName = this.state.players.get(event.entityId)?.displayName ?? '一名玩家';
      const killerId = event.killerId;
      const killerName =
        killerId === undefined
          ? undefined
          : (this.state.players.get(killerId)?.displayName ??
            this.combat.getMonster(killerId)?.displayName);
      if (killerId !== undefined && this.state.players.has(killerId)) {
        this.metrics.recordPvpKill();
      }
      const reviveSeconds = Math.max(1, Math.ceil((event.reviveInMs ?? 3_000) / 1_000));
      this.broadcastSystemNotice(
        'warning',
        killerName === undefined
          ? `${victimName} 倒下了，${String(reviveSeconds)} 秒后复活`
          : `${victimName} 被 ${killerName} 击败，${String(reviveSeconds)} 秒后复活`,
      );
    }
  }

  private toWireEvents(events: readonly CombatEventPayload[]): CombatEvent[] {
    return events.map((payload) =>
      combatEventSchema.parse({
        ...payload,
        eventId: randomUUID(),
        serverTime: Date.now(),
      }),
    );
  }

  private sendProfile(client: Client, playerId: string): void {
    const profile = this.combat.getProfile(playerId);
    if (profile === undefined) {
      return;
    }
    const message: CombatProfile = { characterId: playerId, ...profile };
    client.send(SERVER_MESSAGES.combatProfile, combatProfileSchema.parse(message));
  }

  private handleChat(client: Client, raw: unknown): void {
    const session = this.sessions.get(client.sessionId);
    if (session === undefined) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
      return;
    }
    if (session.transferring) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
      return;
    }

    const parsed = chatSendSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, {}, 'INVALID_PAYLOAD');
      return;
    }
    if (parsed.data.protocolVersion !== PROTOCOL_VERSION) {
      this.sendRejection(client, {}, 'PROTOCOL_MISMATCH');
      return;
    }

    if (session.recentChatIds.has(parsed.data.clientMessageId)) {
      return;
    }
    if (!session.chatBucket.take(Date.now())) {
      this.sendRejection(client, {}, 'RATE_LIMITED');
      return;
    }

    const nowMs = Date.now();
    if (session.mutedUntil !== null && session.mutedUntil > nowMs) {
      this.metrics.recordChatMuted();
      const seconds = Math.ceil((session.mutedUntil - nowMs) / 1_000);
      this.sendSystemNotice(client, 'warning', `你已被管理员禁言，剩余 ${String(seconds)} 秒`);
      return;
    }
    if (session.mutedUntil !== null) {
      session.mutedUntil = null;
    }

    session.recentChatIds.add(parsed.data.clientMessageId);
    if (session.recentChatIds.size > RECENT_CHAT_WINDOW) {
      const oldest = session.recentChatIds.values().next();
      if (!oldest.done) {
        session.recentChatIds.delete(oldest.value);
      }
    }

    const statePlayer = this.state.players.get(session.playerId);
    const displayName = statePlayer?.displayName ?? '';
    if (displayName.length === 0) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
      return;
    }

    const filter = this.options.chatFilter ?? defaultChatFilter;
    const filtered = filter(parsed.data.message);
    if (!filtered.accepted) {
      this.metrics.recordChatFiltered();
      this.sendSystemNotice(client, 'warning', filtered.reason);
      return;
    }

    const message: ChatMessage = {
      messageId: randomUUID(),
      playerId: session.playerId,
      displayName,
      message: filtered.text.slice(0, CHAT_MESSAGE_MAX_LENGTH),
      channel: 'map',
      serverTime: Date.now(),
    };
    this.broadcast(SERVER_MESSAGES.chatMessage, chatMessageSchema.parse(message));
    this.metrics.recordChatMessage();
  }

  private broadcastSystemNotice(kind: SystemNotice['kind'], message: string): void {
    const notice: SystemNotice = {
      kind,
      message: message.slice(0, 200),
      serverTime: Date.now(),
    };
    this.broadcast(SERVER_MESSAGES.systemNotice, systemNoticeSchema.parse(notice));
  }

  private sendSystemNotice(client: Client, kind: SystemNotice['kind'], message: string): void {
    const notice: SystemNotice = {
      kind,
      message: message.slice(0, 200),
      serverTime: Date.now(),
    };
    client.send(SERVER_MESSAGES.systemNotice, systemNoticeSchema.parse(notice));
  }

  private adminSnapshot(): AdminRoom {
    const tick = this.metrics.snapshot().tick;
    return {
      roomId: this.roomId,
      mapId: this.map.mapId,
      instanceId: this.map.instanceId,
      players: this.state.players.size,
      tickP50Ms: tick.p50Ms,
      tickP95Ms: tick.p95Ms,
      tickP99Ms: tick.p99Ms,
      contentVersion: this.content.version,
      contentChecksum: this.content.checksum,
    };
  }

  /**
   * Applies a command delivered by the Control API outbox. Operations only
   * touch this process's live sessions; persisted ban/mute state was already
   * committed by the Control API (ADR-022).
   */
  private applyAdminCommand(command: AdminCommandEnvelope): number {
    switch (command.type) {
      case 'kick': {
        const session = this.findSessionByPlayerId(command.characterId);
        if (session === undefined) {
          return 0;
        }
        this.kickSession(session, 'kicked', command.reason);
        return 1;
      }
      case 'ban': {
        const matching = [...this.sessions.values()].filter(
          (session) => session.accountId === command.accountId,
        );
        for (const session of matching) {
          this.kickSession(session, 'banned', command.reason);
        }
        return matching.length;
      }
      case 'mute': {
        const matching = [...this.sessions.values()].filter(
          (session) => session.accountId === command.accountId,
        );
        const until = new Date(command.mutedUntil).getTime();
        for (const session of matching) {
          session.mutedUntil = until;
          this.sendSystemNotice(session.client, 'warning', '你已被管理员禁言');
        }
        return matching.length;
      }
    }
  }

  private findSessionByPlayerId(playerId: string): SessionRecord | undefined {
    const sessionId = this.sessionByPlayer.get(playerId);
    return sessionId === undefined ? undefined : this.sessions.get(sessionId);
  }

  private kickSession(session: SessionRecord, kind: 'kicked' | 'banned', reason: string): void {
    try {
      session.client.send(
        SERVER_MESSAGES.sessionKicked,
        sessionKickedSchema.parse({ reason, kind, serverTime: Date.now() }),
      );
    } catch (error) {
      this.options.logger.warn(
        { err: error, roomId: this.roomId, characterId: session.playerId },
        'failed to deliver session kicked notice',
      );
    }
    this.options.logger.info(
      { roomId: this.roomId, characterId: session.playerId, accountId: session.accountId, kind },
      'admin disconnected session',
    );
    void session.client.leave(4000, reason);
  }

  private async restoreLoot(): Promise<void> {
    try {
      const drops = await this.assets.loadOpenDrops(this.map.mapId);
      for (const drop of drops) {
        this.addLootState(drop);
      }
      if (drops.length > 0) {
        this.options.logger.info(
          { roomId: this.roomId, mapId: this.map.mapId, drops: drops.length },
          'restored open world drops',
        );
      }
    } catch (error) {
      this.options.logger.error(
        { err: error, roomId: this.roomId, mapId: this.map.mapId },
        'failed to restore world drops',
      );
    }
  }

  private addLootState(drop: LootDropView): void {
    if (this.state.loot.has(drop.dropId)) {
      return;
    }
    const loot = new LootState();
    loot.dropId = drop.dropId;
    loot.itemId = drop.itemId;
    loot.templateId = drop.templateId;
    loot.displayName = drop.displayName;
    loot.quantity = drop.quantity;
    loot.x = drop.x;
    loot.y = drop.y;
    loot.ownerId = drop.ownerId;
    loot.expiresAt = drop.expiresAt;
    this.state.loot.set(drop.dropId, loot);

    const affected = this.interest.add(drop.dropId, tileOfUnits({ x: drop.x, y: drop.y }));
    if (affected.length > 0) {
      this.refreshViews(affected);
    }
  }

  private removeLootState(dropId: string): void {
    if (!this.state.loot.has(dropId)) {
      return;
    }
    const affected = this.interest.remove(dropId);
    this.state.loot.delete(dropId);
    if (affected.length > 0) {
      this.refreshViews(affected);
    }
  }

  private expireLoot(): void {
    const now = Date.now();
    const expired: string[] = [];
    this.state.loot.forEach((loot, dropId) => {
      if (loot.expiresAt <= now) {
        expired.push(dropId);
      }
    });
    for (const dropId of expired) {
      this.removeLootState(dropId);
    }
  }

  private enqueueAsset<T>(task: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    const run = this.assetQueue.then(task, task);
    run.then(
      () => this.metrics.recordAssetDuration(performance.now() - startedAt),
      () => this.metrics.recordAssetDuration(performance.now() - startedAt),
    );
    this.assetQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private scheduleKillReward(event: { entityId: string; killerId?: string | undefined }): void {
    const killerId = event.killerId;
    if (killerId === undefined || !this.state.players.has(killerId)) {
      return;
    }
    const monster = this.combat.getMonster(event.entityId);
    if (monster === undefined) {
      return;
    }
    const reference = `${this.options.serverId}:${this.roomId}:${monster.id}:${String(
      ++this.killSequence,
    )}`;
    const input: KillRewardInput = {
      characterId: killerId,
      mapId: this.map.mapId,
      reference,
      monsterTemplateId: monster.templateId,
      x: monster.x,
      y: monster.y,
    };
    void this.enqueueAsset(() => this.grantRewardWithRetry(input)).catch((error: unknown) => {
      this.metrics.recordAssetFailure();
      this.options.logger.error(
        { err: error, roomId: this.roomId, reference, characterId: killerId },
        'failed to grant kill reward',
      );
    });
  }

  private async grantRewardWithRetry(input: KillRewardInput): Promise<void> {
    for (let attempt = 1; attempt <= REWARD_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const outcome = await this.assets.grantKillReward(input);
        if (outcome !== null) {
          this.applyKillReward(input.characterId, outcome);
        }
        return;
      } catch (error) {
        if (attempt >= REWARD_RETRY_ATTEMPTS) {
          throw error;
        }
        this.options.logger.warn(
          { err: error, roomId: this.roomId, reference: input.reference, attempt },
          'kill reward transaction failed; retrying',
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }
  }

  private applyKillReward(characterId: string, outcome: KillRewardOutcome): void {
    this.metrics.recordExpGranted(outcome.expGained);
    this.metrics.recordGoldGranted(outcome.goldGained);
    this.metrics.recordLootSpawned(outcome.drops.length);
    for (const drop of outcome.drops) {
      this.addLootState(drop);
    }

    this.combat.updatePlayerProgress(characterId, {
      level: outcome.snapshot.level,
      stats: outcome.stats,
      refill: outcome.leveledUp,
    });

    const sessionId = this.sessionByPlayer.get(characterId);
    const session = sessionId === undefined ? undefined : this.sessions.get(sessionId);
    if (session === undefined) {
      return;
    }
    session.assetSnapshot = outcome.snapshot;
    this.sendProgress(session, outcome.leveledUp);
    this.sendProfile(session.client, session.playerId);
    if (outcome.leveledUp) {
      this.broadcastSystemNotice(
        'info',
        `${session.displayName} 升到了 Lv.${String(outcome.snapshot.level)}`,
      );
    }
  }

  private mergedSnapshot(session: SessionRecord): InventorySnapshot {
    const player = this.combat.getPlayer(session.playerId);
    if (player === undefined) {
      return session.assetSnapshot;
    }
    return {
      ...session.assetSnapshot,
      level: player.level,
      hp: player.hp,
      maxHp: player.maxHp,
      mp: player.mp,
      maxMp: player.maxMp,
      attack: player.attack,
      defense: player.defense,
    };
  }

  private sendAssetSnapshot(client: Client, session: SessionRecord): void {
    client.send(
      SERVER_MESSAGES.inventorySnapshot,
      inventorySnapshotSchema.parse(this.mergedSnapshot(session)),
    );
  }

  private sendProgress(session: SessionRecord, leveledUp: boolean): void {
    const snapshot = this.mergedSnapshot(session);
    const progress: CharacterProgress = {
      level: snapshot.level,
      exp: snapshot.exp,
      expToNextLevel: snapshot.expToNextLevel,
      gold: snapshot.gold,
      hp: snapshot.hp,
      maxHp: snapshot.maxHp,
      mp: snapshot.mp,
      maxMp: snapshot.maxMp,
      attack: snapshot.attack,
      defense: snapshot.defense,
      serverTime: Date.now(),
    };
    session.client.send(SERVER_MESSAGES.characterProgress, characterProgressSchema.parse(progress));

    if (leveledUp && snapshot.level >= 2) {
      const levelUp: LevelUp = {
        level: snapshot.level,
        maxHp: snapshot.maxHp,
        maxMp: snapshot.maxMp,
        attack: snapshot.attack,
        defense: snapshot.defense,
        serverTime: Date.now(),
      };
      session.client.send(SERVER_MESSAGES.characterLevelUp, levelUpSchema.parse(levelUp));
    }
  }

  private sendAssetResult(
    client: Client,
    session: SessionRecord,
    commandId: string,
    kind: AssetCommandKind,
    deduplicated: boolean,
  ): void {
    const message: AssetResult = {
      commandId,
      kind,
      deduplicated,
      snapshot: this.mergedSnapshot(session),
      serverTime: Date.now(),
    };
    client.send(SERVER_MESSAGES.assetResult, assetResultSchema.parse(message));
  }

  private handleLootPickup(client: Client, raw: unknown): void {
    const parsed = lootPickupSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    void this.runAssetCommand(
      client,
      command,
      'loot_pickup',
      (session) => {
        const drop = this.state.loot.get(command.dropId);
        if (drop === undefined) {
          return 'ITEM_NOT_FOUND';
        }
        const player = this.combat.getPlayer(session.playerId);
        if (player === undefined) {
          return 'INVALID_SESSION';
        }
        if (!player.alive) {
          return 'PLAYER_DEAD';
        }
        const distance = Math.hypot(player.x - drop.x, player.y - drop.y) / TILE_UNITS;
        return distance > PICKUP_RANGE_TILES ? 'OUT_OF_RANGE' : null;
      },
      (session) =>
        this.assets.pickup({
          characterId: session.playerId,
          commandId: command.commandId,
          dropId: command.dropId,
          mapId: this.map.mapId,
        }),
      (_session, outcome) => {
        if (outcome.claimed !== null) {
          this.removeLootState(command.dropId);
          this.broadcast(SERVER_MESSAGES.lootClaimed, lootClaimedSchema.parse(outcome.claimed));
          this.metrics.recordLootPickedUp();
        }
      },
    );
  }

  private handleInventoryEquip(client: Client, raw: unknown): void {
    const parsed = inventoryEquipSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    void this.runAssetCommand(
      client,
      command,
      'inventory_equip',
      (session) => this.requireAlive(session),
      (session) =>
        this.assets.equip({
          characterId: session.playerId,
          commandId: command.commandId,
          itemId: command.itemId,
        }),
      (session, outcome) => {
        this.combat.updatePlayerProgress(session.playerId, {
          level: outcome.snapshot.level,
          stats: outcome.stats,
        });
        this.sendProfile(session.client, session.playerId);
      },
    );
  }

  private handleInventoryUnequip(client: Client, raw: unknown): void {
    const parsed = inventoryUnequipSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    void this.runAssetCommand(
      client,
      command,
      'inventory_unequip',
      (session) => this.requireAlive(session),
      (session) =>
        this.assets.unequip({
          characterId: session.playerId,
          commandId: command.commandId,
          slot: command.slot,
        }),
      (session, outcome) => {
        this.combat.updatePlayerProgress(session.playerId, {
          level: outcome.snapshot.level,
          stats: outcome.stats,
        });
        this.sendProfile(session.client, session.playerId);
      },
    );
  }

  private handleInventoryUse(client: Client, raw: unknown): void {
    const parsed = inventoryUseSchema.safeParse(raw);
    if (!parsed.success) {
      this.sendRejection(client, extractCommandMeta(raw), 'INVALID_PAYLOAD');
      return;
    }
    const command = parsed.data;
    void this.runAssetCommand(
      client,
      command,
      'inventory_use',
      (session) => this.requireAlive(session),
      (session) => {
        const player = this.combat.getPlayer(session.playerId);
        return this.assets.use({
          characterId: session.playerId,
          commandId: command.commandId,
          itemId: command.itemId,
          vitals: { hp: player?.hp ?? 0, mp: player?.mp ?? 0 },
        });
      },
      (session, outcome) => {
        if (outcome.vitals !== undefined) {
          this.combat.setPlayerVitals(session.playerId, outcome.vitals);
        }
      },
    );
  }

  private requireAlive(session: SessionRecord): CommandRejectionCode | null {
    const player = this.combat.getPlayer(session.playerId);
    if (player === undefined) {
      return 'INVALID_SESSION';
    }
    return player.alive ? null : 'PLAYER_DEAD';
  }

  private async runAssetCommand<
    T extends { snapshot: InventorySnapshot; stats: CombatStats; deduplicated: boolean },
  >(
    client: Client,
    command: { commandId: string; clientSequence: number; protocolVersion: number },
    kind: AssetCommandKind,
    validate: (session: SessionRecord) => CommandRejectionCode | null,
    operation: (session: SessionRecord) => Promise<T>,
    afterCommit: (session: SessionRecord, outcome: T) => void,
  ): Promise<void> {
    const meta = { commandId: command.commandId, clientSequence: command.clientSequence };
    const session = this.sessions.get(client.sessionId);
    if (session === undefined) {
      this.sendRejection(client, meta, 'INVALID_SESSION');
      return;
    }
    if (session.transferring) {
      this.sendRejection(client, meta, 'INVALID_SESSION');
      return;
    }
    if (command.protocolVersion !== PROTOCOL_VERSION) {
      this.sendRejection(client, meta, 'PROTOCOL_MISMATCH');
      return;
    }
    if (session.recentAssets.has(command.commandId)) {
      this.sendAssetResult(client, session, command.commandId, kind, true);
      return;
    }
    if (command.clientSequence <= session.lastSequence) {
      this.sendRejection(client, meta, 'STALE_SEQUENCE');
      return;
    }
    if (!session.rateBucket.take(Date.now())) {
      this.sendRejection(client, meta, 'RATE_LIMITED');
      return;
    }
    const rejection = validate(session);
    if (rejection !== null) {
      this.sendRejection(client, meta, rejection);
      return;
    }

    session.lastSequence = command.clientSequence;
    session.recentAssets.set(command.commandId, kind);
    if (session.recentAssets.size > RECENT_COMMAND_WINDOW) {
      const oldest = session.recentAssets.keys().next();
      if (!oldest.done) {
        session.recentAssets.delete(oldest.value);
      }
    }
    this.metrics.recordAssetCommand();

    let outcome: T;
    try {
      outcome = await this.enqueueAsset(() => operation(session));
    } catch (error) {
      session.recentAssets.delete(command.commandId);
      this.metrics.recordAssetFailure();
      if (error instanceof AssetError) {
        this.sendRejection(client, meta, error.code);
        return;
      }
      this.options.logger.error(
        { err: error, roomId: this.roomId, characterId: session.playerId, kind },
        'asset command failed',
      );
      this.sendRejection(client, meta, 'SERVICE_UNAVAILABLE');
      return;
    }

    // The transaction has committed. A failure while mirroring the result into
    // memory or the socket must never be reported as a rejected asset command.
    session.assetSnapshot = outcome.snapshot;
    try {
      afterCommit(session, outcome);
    } catch (error) {
      this.options.logger.error(
        { err: error, roomId: this.roomId, characterId: session.playerId, kind },
        'failed to apply committed asset result',
      );
    }
    if (this.sessions.get(client.sessionId) === session) {
      try {
        this.sendAssetResult(client, session, command.commandId, kind, outcome.deduplicated);
      } catch (error) {
        this.options.logger.warn(
          { err: error, roomId: this.roomId, characterId: session.playerId, kind },
          'failed to deliver asset result',
        );
      }
    }
    this.metrics.recordAcceptedCommand();
  }

  private sendRejection(
    client: Client,
    meta: { commandId?: string; clientSequence?: number },
    code: CommandRejectionCode,
    options: { message?: string; retryAfterMs?: number } = {},
  ): void {
    const rejection: CommandRejected = {
      code,
      message: options.message ?? COMMAND_REJECTION_MESSAGES[code],
      serverTime: Date.now(),
      ...(meta.commandId === undefined ? {} : { commandId: meta.commandId }),
      ...(meta.clientSequence === undefined ? {} : { clientSequence: meta.clientSequence }),
      ...(options.retryAfterMs === undefined ? {} : { retryAfterMs: options.retryAfterMs }),
    };

    client.send(SERVER_MESSAGES.commandRejected, commandRejectedSchema.parse(rejection));
    this.metrics.recordRejectedCommand(code);
    this.options.logger.debug(
      { roomId: this.roomId, sessionId: client.sessionId, code },
      'command rejected',
    );
  }

  private setConnected(playerId: string, connected: boolean): void {
    const statePlayer: PlayerStateInstance | undefined = this.state.players.get(playerId);
    if (statePlayer !== undefined) {
      statePlayer.connected = connected;
      statePlayer.moving = false;
    }
  }

  private pickSpawnPoint(): TilePoint {
    const occupied = new Set(
      this.simulation.listPlayers().map((player) => {
        const tile = tileOfUnits(player);
        return `${String(tile.x)}:${String(tile.y)}`;
      }),
    );

    for (const point of this.map.runtime.manifest.spawnPoints) {
      if (!occupied.has(`${String(point.x)}:${String(point.y)}`)) {
        return point;
      }
    }

    const spawnPoints = this.map.runtime.manifest.spawnPoints;
    const fallbackIndex = this.simulation.listPlayers().length % spawnPoints.length;
    return spawnPoints[fallbackIndex] ?? tilePointSchema.parse({ x: 1, y: 1 });
  }

  private async removeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return;
    }

    const player = this.simulation.getPlayer(session.playerId);
    const combatPlayer = this.combat.getPlayer(session.playerId);
    const displayName = session.displayName;
    this.sessions.delete(sessionId);
    this.sessionByPlayer.delete(session.playerId);

    const affected = this.interest.remove(session.playerId);
    this.refreshViews(affected);
    this.simulation.removePlayer(session.playerId);
    this.combat.removePlayer(session.playerId);
    this.state.players.delete(session.playerId);
    this.state.playerCount = this.state.players.size;
    this.metrics.setPlayers(this.state.players.size);

    delete session.client.view;
    session.view.dispose();

    if (!session.transferring) {
      if (player !== undefined) {
        try {
          await saveCharacterCheckpoint(this.options.database, {
            characterId: session.playerId,
            x: player.x,
            y: player.y,
            facing: player.facing,
            hp: combatPlayer?.hp ?? session.hp,
            mp: combatPlayer?.mp ?? session.mp,
          });
        } catch (error) {
          this.options.logger.error(
            { err: error, roomId: this.roomId, characterId: session.playerId },
            'failed to checkpoint character position',
          );
        }
      }

      try {
        await releaseCharacterLease(this.options.database, session.playerId, sessionId);
      } catch (error) {
        this.options.logger.error(
          { err: error, roomId: this.roomId, characterId: session.playerId },
          'failed to release character lease',
        );
      }
    }

    if (!session.transferring && this.sessions.size > 0) {
      this.broadcastSystemNotice('info', `${displayName} 离开了地图`);
    }

    this.options.logger.info(
      {
        roomId: this.roomId,
        characterId: session.playerId,
        transferred: session.transferring,
        clients: this.state.players.size,
      },
      'player left world',
    );
  }
}
