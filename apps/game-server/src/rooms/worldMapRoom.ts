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
  PLAYER_SPEED_UNITS_PER_SECOND,
  PROTOCOL_VERSION,
  SERVER_MESSAGES,
  TILE_UNITS,
  chatMessageSchema,
  chatSendSchema,
  commandAckSchema,
  commandRejectedSchema,
  moveToCommandSchema,
  sessionTransferSchema,
  tilePointSchema,
  worldJoinOptionsSchema,
  type ChatMessage,
  type CommandAck,
  type CommandRejected,
  type CommandRejectionCode,
  type Facing,
  type MapPortal,
  type SessionTransfer,
  type TilePoint,
} from '@web-legend/contracts';
import {
  PlayerState,
  WorldState,
  type PlayerStateInstance,
  type WorldStateInstance,
} from '@web-legend/contracts/world-state';
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

import type { MetricsRegistry, RoomMetrics } from '../metrics';
import type { MapInstance } from '../world/mapRegistry';
import { createTokenBucket, type TokenBucket } from '../world/rateLimiter';

export type WorldMapRoomOptions = {
  database: Database;
  serverId: string;
  logger: Logger;
  metrics: MetricsRegistry;
  mapInstance: MapInstance;
  tickHz?: number;
  patchRateMs?: number;
  reconnectGraceSeconds?: number;
  commandRateCapacity?: number;
  commandRateRefillPerSecond?: number;
  chatRateCapacity?: number;
  chatRateRefillPerSecond?: number;
  checkpointIntervalMs?: number;
  interestCellSize?: number;
  interestRadiusCells?: number;
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
  mapId: z.string().min(1),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  facing: z.number().int().min(0).max(3),
  hp: z.number().int().nonnegative(),
  maxHp: z.number().int().positive(),
  mp: z.number().int().nonnegative(),
  maxMp: z.number().int().nonnegative(),
});

type WorldAuthData = z.infer<typeof authDataSchema>;

type SessionRecord = {
  client: Client;
  playerId: string;
  lastSequence: number;
  recentAcks: Map<string, CommandAck>;
  rateBucket: TokenBucket;
  chatBucket: TokenBucket;
  recentChatIds: Set<string>;
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
  private simulation!: WorldSimulation;
  private interest!: InterestManager;
  private runner!: FixedStepRunner;
  private tick = 0;
  private checkpointIntervalMs = DEFAULT_CHECKPOINT_INTERVAL_MS;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sessionByPlayer = new Map<string, string>();

  override onCreate(options: WorldMapRoomOptions): void {
    this.options = options;
    this.map = options.mapInstance;
    this.simulation = new WorldSimulation(this.map.runtime.grid);
    this.interest = new InterestManager({
      cellSize: options.interestCellSize ?? DEFAULT_INTEREST.cellSize,
      radiusCells: options.interestRadiusCells ?? DEFAULT_INTEREST.radiusCells,
    });
    this.metrics = options.metrics.register(this.roomId);

    const tickHz = options.tickHz ?? DEFAULT_TICK_HZ;
    const patchRateMs = options.patchRateMs ?? DEFAULT_PATCH_RATE_MS;
    this.checkpointIntervalMs = options.checkpointIntervalMs ?? DEFAULT_CHECKPOINT_INTERVAL_MS;

    this.state.mapId = this.map.mapId;
    this.state.instanceId = this.map.instanceId;
    this.state.tickHz = tickHz;
    this.state.speedUnitsPerSecond = PLAYER_SPEED_UNITS_PER_SECOND;
    this.setPatchRate(patchRateMs);

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

    this.clock.setInterval(() => {
      void this.refreshLeases();
    }, LEASE_REFRESH_INTERVAL_MS);
    this.clock.setInterval(() => {
      void this.checkpointAll();
    }, this.checkpointIntervalMs);

    options.logger.info(
      {
        roomId: this.roomId,
        mapId: this.map.mapId,
        instanceId: this.map.instanceId,
        tickHz,
        patchRateMs,
        serverId: options.serverId,
      },
      'world map room created',
    );
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
    const auth = authDataSchema.parse(client.auth);
    if (this.sessionByPlayer.has(auth.characterId)) {
      throw new ServerError(ErrorCode.AUTH_FAILED, '该角色正在另一台设备上游戏');
    }

    const spawn = this.resolveSpawn(auth);
    this.simulation.addPlayer({
      id: auth.characterId,
      displayName: auth.displayName,
      spawn: spawn.tile,
      colorIndex: colorIndexFor(auth.characterId),
      ...(spawn.position === undefined ? {} : { position: spawn.position }),
      facing: toFacing(auth.facing),
    });

    const player = new PlayerState();
    player.playerId = auth.characterId;
    player.displayName = auth.displayName;
    player.colorIndex = colorIndexFor(auth.characterId);
    player.hp = auth.hp;
    player.maxHp = auth.maxHp;
    player.mp = auth.mp;
    player.maxMp = auth.maxMp;
    const position = this.simulation.getPlayer(auth.characterId);
    player.x = position?.x ?? 0;
    player.y = position?.y ?? 0;
    player.facing = position?.facing ?? 0;
    this.state.players.set(auth.characterId, player);
    this.state.playerCount = this.state.players.size;

    const view = new StateView();
    const session: SessionRecord = {
      client,
      playerId: auth.characterId,
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
      hp: auth.hp,
      mp: auth.mp,
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
    session.client = client;
    client.view = session.view;
    // A refreshed browser starts a fresh client with sequence 0; accepting its
    // commands again must not depend on the pre-refresh sequence counter.
    session.lastSequence = -1;
    session.recentAcks.clear();
    session.recentChatIds.clear();
    this.setConnected(session.playerId, true);

    if (session.transferring && session.transferTargetMapId !== null) {
      this.sendTransfer(client, session.transferTargetMapId);
    }
    this.options.logger.info(
      { roomId: this.roomId, characterId: session.playerId },
      'player reconnected',
    );
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (session === undefined) {
      return;
    }

    if (code === CloseCode.CONSENTED || session.transferring) {
      await this.removeSession(client.sessionId);
      return;
    }

    this.setConnected(session.playerId, false);
    this.simulation.clearPath(session.playerId);

    try {
      await this.allowReconnection(
        client,
        this.options.reconnectGraceSeconds ?? DEFAULT_RECONNECT_GRACE_SECONDS,
      );
      this.setConnected(session.playerId, true);
    } catch {
      await this.removeSession(client.sessionId);
    }
  }

  override async onDispose(): Promise<void> {
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

    return {
      accountId: character.accountId,
      characterId: character.id,
      realmId: character.realmId,
      displayName: character.name,
      mapId: character.mapId,
      x: character.x,
      y: character.y,
      facing: character.facing,
      hp: character.hp,
      maxHp: character.maxHp,
      mp: character.mp,
      maxMp: character.maxMp,
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
        if (player === undefined) {
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
            hp: session.hp,
            mp: session.mp,
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

    this.simulation.step(1_000 / this.state.tickHz);
    this.syncPlayers();

    for (const player of this.simulation.listPlayers()) {
      const sessionId = this.sessionByPlayer.get(player.id);
      const session = sessionId === undefined ? undefined : this.sessions.get(sessionId);
      if (session === undefined || session.transferring) {
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

  private syncPlayers(): void {
    for (const player of this.simulation.listPlayers()) {
      const statePlayer = this.state.players.get(player.id);
      if (statePlayer === undefined) {
        continue;
      }
      statePlayer.x = player.x;
      statePlayer.y = player.y;
      statePlayer.facing = player.facing;
      statePlayer.moving = player.moving;
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
        const statePlayer = this.state.players.get(visibleId);
        if (statePlayer !== undefined) {
          session.view.add(statePlayer);
          session.visible.add(visibleId);
        }
      }
      for (const visibleId of [...session.visible]) {
        if (desired.has(visibleId)) {
          continue;
        }
        const statePlayer = this.state.players.get(visibleId);
        if (statePlayer !== undefined) {
          session.view.remove(statePlayer);
        }
        session.visible.delete(visibleId);
      }
    }
  }

  private async beginTransfer(
    session: SessionRecord,
    portal: MapPortal,
    player: { facing: Facing },
  ): Promise<void> {
    const target = tileCenter(portal.targetTile);
    try {
      await saveCharacterTransfer(this.options.database, {
        characterId: session.playerId,
        mapId: portal.targetMapId,
        x: target.x,
        y: target.y,
        facing: player.facing,
        hp: session.hp,
        mp: session.mp,
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

    session.recentChatIds.add(parsed.data.clientMessageId);
    if (session.recentChatIds.size > RECENT_CHAT_WINDOW) {
      const oldest = session.recentChatIds.values().next();
      if (!oldest.done) {
        session.recentChatIds.delete(oldest.value);
      }
    }

    const statePlayer = this.state.players.get(session.playerId);
    const message: ChatMessage = {
      messageId: randomUUID(),
      playerId: session.playerId,
      displayName: statePlayer?.displayName ?? '',
      message: parsed.data.message.trim().slice(0, CHAT_MESSAGE_MAX_LENGTH),
      channel: 'map',
      serverTime: Date.now(),
    };
    if (message.displayName.length === 0) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
      return;
    }

    this.broadcast(SERVER_MESSAGES.chatMessage, chatMessageSchema.parse(message));
    this.metrics.recordChatMessage();
  }

  private sendRejection(
    client: Client,
    meta: { commandId?: string; clientSequence?: number },
    code: CommandRejectionCode,
  ): void {
    const rejection: CommandRejected = {
      code,
      message: COMMAND_REJECTION_MESSAGES[code],
      serverTime: Date.now(),
      ...(meta.commandId === undefined ? {} : { commandId: meta.commandId }),
      ...(meta.clientSequence === undefined ? {} : { clientSequence: meta.clientSequence }),
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
    this.sessions.delete(sessionId);
    this.sessionByPlayer.delete(session.playerId);

    const affected = this.interest.remove(session.playerId);
    this.refreshViews(affected);
    this.simulation.removePlayer(session.playerId);
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
            hp: session.hp,
            mp: session.mp,
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
