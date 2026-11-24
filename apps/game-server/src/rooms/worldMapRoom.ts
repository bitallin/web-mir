import { CloseCode, ErrorCode, Room, ServerError, type Client } from '@colyseus/core';
import {
  CLIENT_MESSAGES,
  COMMAND_REJECTION_MESSAGES,
  DEFAULT_PATCH_RATE_MS,
  DEFAULT_TICK_HZ,
  isTileInsideMap,
  isTileWalkable,
  moveToCommandSchema,
  PLAYER_SPEED_UNITS_PER_SECOND,
  PROTOCOL_VERSION,
  SERVER_MESSAGES,
  commandAckSchema,
  commandRejectedSchema,
  tilePointSchema,
  worldJoinOptionsSchema,
  type CommandAck,
  type CommandRejected,
  type CommandRejectionCode,
  type TilePoint,
} from '@web-legend/contracts';
import {
  PlayerState,
  WorldState,
  type PlayerStateInstance,
  type WorldStateInstance,
} from '@web-legend/contracts/world-state';
import {
  createFixedStepRunner,
  findPath,
  gridFromManifest,
  tileOfUnits,
  WorldSimulation,
  type FixedStepRunner,
  type MovementGrid,
} from '@web-legend/game-simulation';
import type { Logger } from 'pino';
import { z } from 'zod';

import type { MetricsRegistry, RoomMetrics } from '../metrics';
import { PHASE1_TEST_MAP } from '../world/mapLoader';
import { createTokenBucket, type TokenBucket } from '../world/rateLimiter';

export type WorldMapRoomOptions = {
  /** False in production until phase 2 game tickets exist. */
  allowDevIdentity: boolean;
  logger: Logger;
  metrics: MetricsRegistry;
  tickHz?: number;
  patchRateMs?: number;
  reconnectGraceSeconds?: number;
  commandRateCapacity?: number;
  commandRateRefillPerSecond?: number;
};

const DEFAULT_RECONNECT_GRACE_SECONDS = 15;
const DEFAULT_COMMAND_RATE_CAPACITY = 10;
const DEFAULT_COMMAND_RATE_REFILL_PER_SECOND = 10;
const RECENT_COMMAND_WINDOW = 32;
const COLOR_COUNT = 6;

const authDataSchema = z.object({
  playerId: z.string().min(1),
  displayName: z.string().min(1),
});

type SessionRecord = {
  playerId: string;
  lastSequence: number;
  recentAcks: Map<string, CommandAck>;
  rateBucket: TokenBucket;
};

function colorIndexFor(playerId: string): number {
  let hash = 0;
  for (const char of playerId) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
  }
  return hash % COLOR_COUNT;
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

/**
 * One Colyseus room per map instance (ADR-003). The room performs connection
 * adaptation only: identity, rate limiting, routing and state synchronization.
 * Movement rules live in `@web-legend/game-simulation`.
 */
export class WorldMapRoom extends Room<{ state: WorldStateInstance }> {
  override maxClients = 50;

  override state = new WorldState();

  private options!: WorldMapRoomOptions;
  private metrics!: RoomMetrics;
  private grid!: MovementGrid;
  private simulation!: WorldSimulation;
  private runner!: FixedStepRunner;
  private tick = 0;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sessionByPlayer = new Map<string, string>();

  override onCreate(options: WorldMapRoomOptions): void {
    this.options = options;
    this.grid = gridFromManifest(PHASE1_TEST_MAP);
    this.simulation = new WorldSimulation(this.grid);
    this.metrics = options.metrics.register(this.roomId);

    const tickHz = options.tickHz ?? DEFAULT_TICK_HZ;
    const patchRateMs = options.patchRateMs ?? DEFAULT_PATCH_RATE_MS;

    this.state.mapId = PHASE1_TEST_MAP.id;
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

    options.logger.info(
      { roomId: this.roomId, mapId: PHASE1_TEST_MAP.id, tickHz, patchRateMs },
      'world map room created',
    );
  }

  override onAuth(_client: Client, rawOptions: unknown): { playerId: string; displayName: string } {
    if (!this.options.allowDevIdentity) {
      throw new ServerError(
        ErrorCode.AUTH_FAILED,
        'Game tickets are required; the development identity is disabled in production',
      );
    }

    const parsed = worldJoinOptionsSchema.safeParse(rawOptions);
    if (!parsed.success) {
      throw new ServerError(ErrorCode.AUTH_FAILED, 'Invalid join options');
    }
    if (parsed.data.protocolVersion !== PROTOCOL_VERSION) {
      throw new ServerError(
        ErrorCode.AUTH_FAILED,
        `Protocol version ${String(PROTOCOL_VERSION)} required`,
      );
    }
    if (
      this.sessionByPlayer.has(parsed.data.playerKey) ||
      this.state.players.has(parsed.data.playerKey)
    ) {
      throw new ServerError(ErrorCode.AUTH_FAILED, 'This player is already connected');
    }

    return { playerId: parsed.data.playerKey, displayName: parsed.data.displayName };
  }

  override onJoin(client: Client): void {
    const auth = authDataSchema.parse(client.auth);
    if (this.sessionByPlayer.has(auth.playerId)) {
      throw new ServerError(ErrorCode.AUTH_FAILED, 'This player is already connected');
    }

    const spawn = this.pickSpawnPoint();
    this.simulation.addPlayer({
      id: auth.playerId,
      displayName: auth.displayName,
      spawn,
      colorIndex: colorIndexFor(auth.playerId),
    });

    const player = new PlayerState();
    player.playerId = auth.playerId;
    player.displayName = auth.displayName;
    player.colorIndex = colorIndexFor(auth.playerId);
    const position = this.simulation.getPlayer(auth.playerId);
    player.x = position?.x ?? 0;
    player.y = position?.y ?? 0;
    player.facing = position?.facing ?? 0;
    this.state.players.set(auth.playerId, player);
    this.state.playerCount = this.state.players.size;

    this.sessions.set(client.sessionId, {
      playerId: auth.playerId,
      lastSequence: -1,
      recentAcks: new Map(),
      rateBucket: createTokenBucket({
        capacity: this.options.commandRateCapacity ?? DEFAULT_COMMAND_RATE_CAPACITY,
        refillPerSecond:
          this.options.commandRateRefillPerSecond ?? DEFAULT_COMMAND_RATE_REFILL_PER_SECOND,
        startMs: Date.now(),
      }),
    });
    this.sessionByPlayer.set(auth.playerId, client.sessionId);
    this.metrics.setPlayers(this.state.players.size);

    this.options.logger.info(
      { roomId: this.roomId, playerId: auth.playerId, spawn, clients: this.state.players.size },
      'player joined world',
    );
  }

  override onReconnect(client: Client): void {
    const session = this.sessions.get(client.sessionId);
    if (session === undefined) {
      return;
    }
    // A refreshed browser starts a fresh client with sequence 0; accepting its
    // commands again must not depend on the pre-refresh sequence counter.
    session.lastSequence = -1;
    session.recentAcks.clear();
    this.setConnected(session.playerId, true);
    this.options.logger.info(
      { roomId: this.roomId, playerId: session.playerId },
      'player reconnected',
    );
  }

  override async onLeave(client: Client, code?: number): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (session === undefined) {
      return;
    }

    if (code === CloseCode.CONSENTED) {
      this.removeSession(client.sessionId);
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
      this.removeSession(client.sessionId);
    }
  }

  override onDispose(): void {
    this.options.metrics.unregister(this.roomId);
    this.options.logger.info({ roomId: this.roomId }, 'world map room disposed');
  }

  private simulateTick(): void {
    const started = performance.now();
    this.state.serverTick = this.tick;
    this.tick += 1;

    this.simulation.step(1_000 / this.state.tickHz);

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

    this.metrics.recordTick(performance.now() - started);
  }

  private handleMove(client: Client, raw: unknown): void {
    const session = this.sessions.get(client.sessionId);
    if (session === undefined) {
      this.sendRejection(client, {}, 'INVALID_SESSION');
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
    if (!isTileInsideMap(PHASE1_TEST_MAP, target.x, target.y)) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'INVALID_TARGET',
      );
      return;
    }
    if (!isTileWalkable(PHASE1_TEST_MAP, target.x, target.y)) {
      this.sendRejection(
        client,
        { commandId: command.commandId, clientSequence: command.clientSequence },
        'INVALID_TARGET',
      );
      return;
    }

    const path = findPath(this.grid, tileOfUnits(player), target);
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

    for (const point of PHASE1_TEST_MAP.spawnPoints) {
      if (!occupied.has(`${String(point.x)}:${String(point.y)}`)) {
        return point;
      }
    }

    const fallbackIndex = this.simulation.listPlayers().length % PHASE1_TEST_MAP.spawnPoints.length;
    return PHASE1_TEST_MAP.spawnPoints[fallbackIndex] ?? tilePointSchema.parse({ x: 1, y: 1 });
  }

  private removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return;
    }

    this.sessions.delete(sessionId);
    this.sessionByPlayer.delete(session.playerId);
    this.simulation.removePlayer(session.playerId);
    this.state.players.delete(session.playerId);
    this.state.playerCount = this.state.players.size;
    this.metrics.setPlayers(this.state.players.size);

    this.options.logger.info(
      { roomId: this.roomId, playerId: session.playerId, clients: this.state.players.size },
      'player left world',
    );
  }
}
