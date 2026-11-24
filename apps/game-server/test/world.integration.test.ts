import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  STARTER_TOWN_MAP_ID,
  STARTER_WILDS_MAP_ID,
  chatMessageSchema,
  commandAckSchema,
  sessionTransferSchema,
  commandRejectedSchema,
  PROTOCOL_VERSION,
  TILE_UNITS,
  worldRoomNameFor,
  type ChatMessage,
  type CommandAck,
  type CommandRejected,
  type SessionTransfer,
} from '@web-legend/contracts';
import { STARTER_TOWN_MAP, STARTER_WILDS_MAP } from '@web-legend/contracts/maps';
import {
  WorldState,
  type PlayerStateInstance,
  type WorldStateInstance,
} from '@web-legend/contracts/world-state';
import { createLogger } from '@web-legend/observability';
import {
  createDatabase,
  findCharacterById,
  findCharacterLease,
  type Database,
  type DatabaseHandle,
} from '@web-legend/persistence';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { GameServerEnv } from '../src/env';
import { createGameServer, type GameServerRuntime } from '../src/server';
import { createActor, issueTicket, tileUnits, type TestActor } from './worldTestHelpers';

const databaseUrl = process.env.DATABASE_URL;

function requireDatabaseUrl(): string {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required for game server integration tests');
  }
  return databaseUrl;
}

const logger = () =>
  createLogger({
    service: 'game-server',
    level: 'silent',
    destination: { write: () => undefined },
  });

async function reservePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('Failed to reserve a TCP port'));
        return;
      }
      const { port } = address;
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5_000,
  label = 'condition',
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${label}`));
      }
    }, 10);
  });
}

async function waitUntilAsync(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000,
  label = 'condition',
): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (await predicate()) {
      return;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function waitForMessage<T>(
  room: SdkRoom,
  type: string,
  parse: (payload: unknown) => T,
  timeoutMs = 5_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for "${type}"`));
    }, timeoutMs);

    unsubscribe = room.onMessage(type, (payload: unknown) => {
      clearTimeout(timer);
      unsubscribe();
      try {
        resolve(parse(payload));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

type WorldRoom = SdkRoom<unknown, WorldStateInstance>;

function joinOptions(ticket: string): Record<string, unknown> {
  return { protocolVersion: PROTOCOL_VERSION, ticket };
}

function playerTile(room: WorldRoom, playerId: string): { x: number; y: number } | undefined {
  const player = room.state.players.get(playerId);
  if (player === undefined) {
    return undefined;
  }
  return { x: Math.floor(player.x / TILE_UNITS), y: Math.floor(player.y / TILE_UNITS) };
}

function playerCount(room: WorldRoom): number {
  return room.state.players.size;
}

async function waitForPlayer(room: WorldRoom, playerId: string): Promise<PlayerStateInstance> {
  await waitUntil(() => room.state.players.get(playerId) !== undefined, 5_000, 'self player');
  const player = room.state.players.get(playerId);
  if (player === undefined) {
    throw new Error('Player was unexpectedly absent');
  }
  return player;
}

describe.runIf(databaseUrl !== undefined)('world_map room', () => {
  let database: DatabaseHandle;
  let runtime: GameServerRuntime;
  let db: Database;
  let baseUrl: string;
  const cleanups: (() => Promise<void>)[] = [];
  const clients: Client[] = [];

  function client(): Client {
    const instance = new Client(baseUrl);
    clients.push(instance);
    return instance;
  }

  async function createWorld(
    ticket: string,
    mapId: string = STARTER_TOWN_MAP_ID,
  ): Promise<WorldRoom> {
    const room = (await client().create(
      worldRoomNameFor(mapId),
      joinOptions(ticket),
      WorldState,
    )) as WorldRoom;
    cleanups.push(async () => {
      await room.leave();
    });
    return room;
  }

  async function joinWorld(roomId: string, ticket: string): Promise<WorldRoom> {
    const room = (await client().joinById(roomId, joinOptions(ticket), WorldState)) as WorldRoom;
    cleanups.push(async () => {
      await room.leave();
    });
    return room;
  }

  beforeAll(async () => {
    const port = await reservePort();
    database = createDatabase(requireDatabaseUrl(), { max: 5 });
    db = database.db;

    const env: GameServerEnv = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      GAME_SERVER_HOST: '127.0.0.1',
      GAME_SERVER_PORT: port,
      DATABASE_URL: requireDatabaseUrl(),
      GAME_SERVER_ID: 'game-server-test',
    };

    runtime = createGameServer({
      env,
      logger: logger(),
      database: db,
      world: { reconnectGraceSeconds: 1, checkpointIntervalMs: 250 },
    });

    await runtime.listen();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
    clients.splice(0);
  });

  afterAll(async () => {
    await runtime?.shutdown();
    await database?.close();
  });

  it('lets two clients see each other as their persisted characters', async () => {
    const alice = await createActor(db, 'Alice', { position: { x: 16_500, y: 10_500 } });
    const bob = await createActor(db, 'Bob', { position: { x: 17_500, y: 10_500 } });
    const aliceRoom = await createWorld(alice.ticket);
    const bobRoom = await joinWorld(aliceRoom.roomId, bob.ticket);

    await waitUntil(
      () => playerCount(aliceRoom) === 2 && playerCount(bobRoom) === 2,
      5_000,
      'both players visible',
    );

    expect(aliceRoom.state.mapId).toBe(STARTER_TOWN_MAP_ID);
    expect(aliceRoom.state.tickHz).toBe(20);

    const names = [...bobRoom.state.players.values()].map((player) => player.displayName).sort();
    expect(names).toEqual([alice.character.name, bob.character.name].sort());

    expect(aliceRoom.state.players.get(alice.character.id)?.displayName).toBe(alice.character.name);
    expect(bobRoom.state.players.get(bob.character.id)?.displayName).toBe(bob.character.name);
    expect(aliceRoom.state.players.has(alice.character.id)).toBe(true);
    expect(bobRoom.state.players.has(bob.character.id)).toBe(true);
    expect(aliceRoom.state.players.get(alice.character.id)?.x).toBe(16_500);
    expect(bobRoom.state.players.get(bob.character.id)?.y).toBe(10_500);
  });

  it('applies an intent server-side and shows it to the other client within 250ms', async () => {
    const alice = await createActor(db, 'Alice');
    const bob = await createActor(db, 'Bob', { position: { x: 17_500, y: 10_500 } });
    const aliceRoom = await createWorld(alice.ticket);
    const bobRoom = await joinWorld(aliceRoom.roomId, bob.ticket);
    await waitUntil(() => playerCount(bobRoom) === 2, 5_000, 'both players visible');

    const alicePlayer = await waitForPlayer(aliceRoom, alice.character.id);
    const start = { x: alicePlayer.x, y: alicePlayer.y };
    const startTile = playerTile(aliceRoom, alice.character.id);
    expect(startTile).toBeDefined();
    if (startTile === undefined) {
      return;
    }

    const target = { x: startTile.x + 2, y: startTile.y };
    const ackPromise = waitForMessage<CommandAck>(aliceRoom, 'command.ack', (payload) =>
      commandAckSchema.parse(payload),
    );

    const clickedAt = performance.now();
    aliceRoom.send('move.to', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetTileX: target.x,
      targetTileY: target.y,
    });

    const ack = await ackPromise;
    expect(ack.path.at(-1)).toEqual(target);
    expect(ack.deduplicated).toBe(false);

    await waitUntil(
      () => {
        const view = bobRoom.state.players.get(alice.character.id);
        return view !== undefined && view.x !== start.x;
      },
      2_000,
      'remote player movement',
    );
    const visibleAfterMs = performance.now() - clickedAt;

    expect(visibleAfterMs).toBeLessThan(250);

    await waitUntil(
      () => playerTile(bobRoom, alice.character.id)?.x === target.x,
      2_000,
      'movement to finish',
    );
    expect(playerTile(aliceRoom, alice.character.id)).toEqual(target);
  });

  it('rejects forged payloads, wrong protocols and illegal or unreachable targets', async () => {
    const alice = await createActor(db, 'Alice');
    const room = await createWorld(alice.ticket);
    const self = await waitForPlayer(room, alice.character.id);
    const start = { x: self.x, y: self.y };
    const tile = playerTile(room, alice.character.id);
    expect(tile).toBeDefined();
    if (tile === undefined) {
      return;
    }

    const sendAndReject = async (payload: unknown): Promise<CommandRejected> => {
      const rejection = waitForMessage<CommandRejected>(room, 'command.rejected', (body) =>
        commandRejectedSchema.parse(body),
      );
      room.send('move.to', payload);
      return rejection;
    };

    const forged = await sendAndReject({
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetTileX: tile.x,
      targetTileY: tile.y,
      x: 99_000,
      y: 99_000,
    });
    expect(forged.code).toBe('INVALID_PAYLOAD');

    const wrongProtocol = await sendAndReject({
      protocolVersion: 999,
      commandId: randomUUID(),
      clientSequence: 1,
      targetTileX: tile.x,
      targetTileY: tile.y,
    });
    expect(wrongProtocol.code).toBe('PROTOCOL_MISMATCH');

    const wall = await sendAndReject({
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 2,
      targetTileX: 0,
      targetTileY: 0,
    });
    expect(wall.code).toBe('INVALID_TARGET');

    const sealed = await sendAndReject({
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 3,
      targetTileX: 21,
      targetTileY: 5,
    });
    expect(sealed.code).toBe('UNREACHABLE');

    expect(room.state.players.get(alice.character.id)?.x).toBe(start.x);
    expect(room.state.players.get(alice.character.id)?.y).toBe(start.y);
  });

  it('deduplicates command ids and rejects stale sequences', async () => {
    const alice = await createActor(db, 'Alice');
    const room = await createWorld(alice.ticket);
    await waitForPlayer(room, alice.character.id);
    const tile = playerTile(room, alice.character.id);
    expect(tile).toBeDefined();
    if (tile === undefined) {
      return;
    }

    const command = {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetTileX: tile.x + 1,
      targetTileY: tile.y,
    };

    const first = waitForMessage<CommandAck>(room, 'command.ack', (body) =>
      commandAckSchema.parse(body),
    );
    room.send('move.to', command);
    expect((await first).deduplicated).toBe(false);

    const duplicate = waitForMessage<CommandAck>(room, 'command.ack', (body) =>
      commandAckSchema.parse(body),
    );
    room.send('move.to', command);
    const replay = await duplicate;
    expect(replay.commandId).toBe(command.commandId);
    expect(replay.deduplicated).toBe(true);

    const stale = waitForMessage<CommandRejected>(room, 'command.rejected', (body) =>
      commandRejectedSchema.parse(body),
    );
    room.send('move.to', { ...command, commandId: randomUUID() });
    expect((await stale).code).toBe('STALE_SEQUENCE');
  });

  it('rate limits command bursts', async () => {
    const alice = await createActor(db, 'Alice');
    const room = await createWorld(alice.ticket);
    await waitForPlayer(room, alice.character.id);
    const tile = playerTile(room, alice.character.id);
    expect(tile).toBeDefined();
    if (tile === undefined) {
      return;
    }

    const rejections: CommandRejected[] = [];
    const total = 30;
    let responses = 0;
    const unsubscribeAck = room.onMessage('command.ack', () => {
      responses += 1;
    });
    const unsubscribeReject = room.onMessage('command.rejected', (payload: unknown) => {
      rejections.push(commandRejectedSchema.parse(payload));
      responses += 1;
    });

    try {
      for (let index = 0; index < total; index += 1) {
        room.send('move.to', {
          protocolVersion: PROTOCOL_VERSION,
          commandId: randomUUID(),
          clientSequence: index,
          targetTileX: tile.x + 1 + (index % 2),
          targetTileY: tile.y,
        });
      }

      await waitUntil(() => responses >= total, 5_000, 'all command responses');
      expect(rejections.some((rejection) => rejection.code === 'RATE_LIMITED')).toBe(true);
    } finally {
      unsubscribeAck();
      unsubscribeReject();
    }
  });

  it('reconnects a dropped client within the grace period', async () => {
    const alice = await createActor(db, 'Alice');
    const room = await createWorld(alice.ticket);
    const self = await waitForPlayer(room, alice.character.id);
    const playerId = self.playerId;
    const sessionId = room.sessionId;
    room.reconnection.minUptime = 0;
    room.reconnection.minDelay = 100;
    room.reconnection.maxDelay = 300;

    const beforeDrop = waitForMessage<CommandAck>(room, 'command.ack', (body) =>
      commandAckSchema.parse(body),
    );
    const beforeTile = playerTile(room, playerId);
    expect(beforeTile).toBeDefined();
    if (beforeTile === undefined) {
      return;
    }
    room.send('move.to', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetTileX: beforeTile.x + 1,
      targetTileY: beforeTile.y,
    });
    await beforeDrop;

    const reconnected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for reconnect')), 10_000);
      room.onReconnect.once(() => {
        clearTimeout(timer);
        resolve();
      });
    });

    room.connection.close();
    await reconnected;

    expect(room.sessionId).toBe(sessionId);
    await waitUntil(
      () => room.state.players.get(playerId)?.connected === true,
      5_000,
      'player marked connected',
    );
    expect(playerCount(room)).toBe(1);

    // A refreshed page after reconnection starts its sequence at 0 again.
    const ack = waitForMessage<CommandAck>(room, 'command.ack', (body) =>
      commandAckSchema.parse(body),
    );
    const tile = playerTile(room, playerId);
    expect(tile).toBeDefined();
    if (tile === undefined) {
      return;
    }
    room.send('move.to', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetTileX: tile.x + 1,
      targetTileY: tile.y,
    });
    const replayed = await ack;
    expect(replayed.deduplicated).toBe(false);
    expect(replayed.path.length).toBeGreaterThan(0);
  });

  it('removes the player after the reconnect grace period expires', async () => {
    const alice = await createActor(db, 'Alice');
    const bob = await createActor(db, 'Bob', { position: { x: 17_500, y: 10_500 } });
    const room = await createWorld(alice.ticket);
    const observer = await joinWorld(room.roomId, bob.ticket);
    await waitUntil(() => playerCount(observer) === 2, 5_000, 'both players visible');

    room.reconnection.enabled = false;
    room.connection.close();

    await waitUntil(
      () => observer.state.players.get(alice.character.id) === undefined,
      5_000,
      'dropped player cleanup',
    );
    expect(playerCount(observer)).toBe(1);
    await waitUntilAsync(
      async () => (await findCharacterLease(db, alice.character.id)) === undefined,
      5_000,
      'lease release',
    );
  });

  it('exposes tick, player and command metrics', async () => {
    const alice = await createActor(db, 'Alice');
    const room = await createWorld(alice.ticket);
    await waitForPlayer(room, alice.character.id);
    const tile = playerTile(room, alice.character.id);
    expect(tile).toBeDefined();
    if (tile === undefined) {
      return;
    }

    const ack = waitForMessage<CommandAck>(room, 'command.ack', (body) =>
      commandAckSchema.parse(body),
    );
    room.send('move.to', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetTileX: tile.x + 1,
      targetTileY: tile.y,
    });
    await ack;
    await waitUntil(() => room.state.serverTick > 2, 5_000, 'simulation ticks');

    const response = await fetch(`${baseUrl}/metrics`);
    const body = (await response.json()) as {
      rooms: {
        roomId: string;
        players: number;
        acceptedCommands: number;
        tick: { samples: number; p95Ms: number };
      }[];
    };

    expect(response.status).toBe(200);
    const roomMetrics = body.rooms.find((entry) => entry.roomId === room.roomId);
    expect(roomMetrics).toBeDefined();
    expect(roomMetrics?.players).toBe(1);
    expect(roomMetrics?.acceptedCommands).toBeGreaterThanOrEqual(1);
    expect(roomMetrics?.tick.samples).toBeGreaterThan(0);
    expect(roomMetrics?.tick.p95Ms).toBeLessThan(25);
  });

  it('rejects missing, forged, expired and already consumed tickets', async () => {
    const alice = await createActor(db, 'Alice');

    await expect(createWorld('A'.repeat(43))).rejects.toMatchObject({ code: 525 });

    const expiredTicket = await issueTicket(db, alice, -1);
    await expect(createWorld(expiredTicket)).rejects.toMatchObject({ code: 525 });

    const room = await createWorld(alice.ticket);
    await waitForPlayer(room, alice.character.id);
    await room.leave();

    await expect(createWorld(alice.ticket)).rejects.toMatchObject({ code: 525 });
  });

  it('lets only one client control a character at a time', async () => {
    const alice = await createActor(db, 'Alice');
    const firstRoom = await createWorld(alice.ticket);
    await waitForPlayer(firstRoom, alice.character.id);

    const secondTicket = await issueTicket(db, alice);
    await expect(createWorld(secondTicket)).rejects.toMatchObject({ code: 525 });

    await firstRoom.leave();
    await waitUntilAsync(
      async () => (await findCharacterLease(db, alice.character.id)) === undefined,
      5_000,
      'lease release after leave',
    );

    const thirdTicket = await issueTicket(db, alice);
    const secondRoom = await createWorld(thirdTicket);
    await waitForPlayer(secondRoom, alice.character.id);
    expect(secondRoom.state.players.get(alice.character.id)?.displayName).toBe(
      alice.character.name,
    );
  });

  it('restores the persisted position and facing on join', async () => {
    const alice = await createActor(db, 'Alice', {
      position: { x: 16_700, y: 10_300 },
      facing: 1,
    });
    const room = await createWorld(alice.ticket);
    const player = await waitForPlayer(room, alice.character.id);

    expect(player.x).toBe(16_700);
    expect(player.y).toBe(10_300);
    expect(player.facing).toBe(1);
  });

  it('checkpoints the authoritative position when the player leaves', async () => {
    const alice: TestActor = await createActor(db, 'Alice');
    const room = await createWorld(alice.ticket);
    await waitForPlayer(room, alice.character.id);

    const tile = playerTile(room, alice.character.id);
    expect(tile).toBeDefined();
    if (tile === undefined) {
      return;
    }
    const target = { x: tile.x + 2, y: tile.y };
    const targetX = target.x * TILE_UNITS + TILE_UNITS / 2;

    const ack = waitForMessage<CommandAck>(room, 'command.ack', (body) =>
      commandAckSchema.parse(body),
    );
    room.send('move.to', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetTileX: target.x,
      targetTileY: target.y,
    });
    await ack;
    await waitUntil(
      () => room.state.players.get(alice.character.id)?.x === targetX,
      5_000,
      'movement to finish at tile center',
    );

    await room.leave();

    await waitUntilAsync(
      async () => {
        const stored = await findCharacterById(db, alice.character.id);
        return stored?.x === targetX;
      },
      5_000,
      'position checkpoint',
    );
    const stored = await findCharacterById(db, alice.character.id);
    expect(stored?.y).toBe(target.y * TILE_UNITS + TILE_UNITS / 2);
    expect(stored?.version).toBeGreaterThan(alice.character.version);

    // A fresh room must restore the committed position from PostgreSQL.
    const restartTicket = await issueTicket(db, alice);
    const restarted = await createWorld(restartTicket);
    const restored = await waitForPlayer(restarted, alice.character.id);
    expect(restored.x).toBe(targetX);
    expect(restored.y).toBe(target.y * TILE_UNITS + TILE_UNITS / 2);
  });

  it('throttled checkpoints persist movement without leaving the world', async () => {
    const alice = await createActor(db, 'Alice');
    const room = await createWorld(alice.ticket);
    await waitForPlayer(room, alice.character.id);
    const tile = playerTile(room, alice.character.id);
    expect(tile).toBeDefined();
    if (tile === undefined) {
      return;
    }
    const target = { x: tile.x + 1, y: tile.y };
    const targetX = target.x * TILE_UNITS + TILE_UNITS / 2;

    const ack = waitForMessage<CommandAck>(room, 'command.ack', (body) =>
      commandAckSchema.parse(body),
    );
    room.send('move.to', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetTileX: target.x,
      targetTileY: target.y,
    });
    await ack;

    await waitUntilAsync(
      async () => (await findCharacterById(db, alice.character.id))?.x === targetX,
      5_000,
      'throttled checkpoint',
    );
    await waitUntil(
      () => room.state.players.get(alice.character.id)?.x === targetX,
      5_000,
      'server position',
    );
  });

  it('only sends entities inside the AOI cells to each client', async () => {
    const alice = await createActor(db, 'Alice', { position: tileUnits({ x: 2, y: 10 }) });
    const bob = await createActor(db, 'Bob', { position: tileUnits({ x: 36, y: 10 }) });
    const aliceRoom = await createWorld(alice.ticket);
    const bobRoom = await joinWorld(aliceRoom.roomId, bob.ticket);

    await waitUntil(
      () => aliceRoom.state.playerCount === 2 && bobRoom.state.playerCount === 2,
      5_000,
      'both players in the authoritative room',
    );
    await waitUntil(
      () => playerCount(aliceRoom) === 1 && playerCount(bobRoom) === 1,
      5_000,
      'AOI filtering',
    );

    expect(aliceRoom.state.players.get(alice.character.id)).toBeDefined();
    expect(aliceRoom.state.players.get(bob.character.id)).toBeUndefined();
    expect(bobRoom.state.players.get(bob.character.id)).toBeDefined();
    expect(bobRoom.state.players.get(alice.character.id)).toBeUndefined();
  });

  it('broadcasts same-map chat, deduplicates ids and enforces limits', async () => {
    const alice = await createActor(db, 'Alice');
    const bob = await createActor(db, 'Bob');
    const aliceRoom = await createWorld(alice.ticket);
    const bobRoom = await joinWorld(aliceRoom.roomId, bob.ticket);
    await waitUntil(
      () => playerCount(aliceRoom) === 2 && playerCount(bobRoom) === 2,
      5_000,
      'both players visible',
    );

    const aliceMessages: ChatMessage[] = [];
    const bobMessages: ChatMessage[] = [];
    const aliceRejections: CommandRejected[] = [];
    const offAliceChat = aliceRoom.onMessage('chat.message', (payload: unknown) => {
      aliceMessages.push(chatMessageSchema.parse(payload));
    });
    const offBobChat = bobRoom.onMessage('chat.message', (payload: unknown) => {
      bobMessages.push(chatMessageSchema.parse(payload));
    });
    const offReject = aliceRoom.onMessage('command.rejected', (payload: unknown) => {
      aliceRejections.push(commandRejectedSchema.parse(payload));
    });

    try {
      const clientMessageId = randomUUID();
      const chat = {
        protocolVersion: PROTOCOL_VERSION,
        clientMessageId,
        message: '组队去野外吗？',
      };
      aliceRoom.send('chat.send', chat);
      await waitUntil(
        () => aliceMessages.length >= 1 && bobMessages.length >= 1,
        5_000,
        'chat broadcast',
      );
      expect(bobMessages[0]?.message).toBe('组队去野外吗？');
      expect(bobMessages[0]?.playerId).toBe(alice.character.id);

      aliceRoom.send('chat.send', chat);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(aliceMessages).toHaveLength(1);

      aliceRoom.send('chat.send', {
        protocolVersion: PROTOCOL_VERSION,
        clientMessageId: randomUUID(),
        message: 'x'.repeat(121),
      });
      await waitUntil(
        () => aliceRejections.some((rejection) => rejection.code === 'INVALID_PAYLOAD'),
        5_000,
        'oversized chat rejection',
      );

      for (let index = 0; index < 12; index += 1) {
        aliceRoom.send('chat.send', {
          protocolVersion: PROTOCOL_VERSION,
          clientMessageId: randomUUID(),
          message: `burst ${String(index)}`,
        });
      }
      await waitUntil(
        () => aliceRejections.some((rejection) => rejection.code === 'RATE_LIMITED'),
        5_000,
        'chat rate limit',
      );
    } finally {
      offAliceChat();
      offBobChat();
      offReject();
    }
  });

  it('transfers through a portal without duplicating the character and back again', async () => {
    const alice = await createActor(db, 'Alice', {
      position: tileUnits({ x: 38, y: 15 }),
    });
    const room = await createWorld(alice.ticket);

    const outbound = await waitForMessage<SessionTransfer>(room, 'session.transfer', (payload) =>
      sessionTransferSchema.parse(payload),
    );
    expect(outbound.mapId).toBe(STARTER_WILDS_MAP_ID);

    const townPortal = STARTER_TOWN_MAP.portals[0];
    if (townPortal === undefined) {
      throw new Error('starter town has no portal');
    }
    const entry = tileUnits(townPortal.targetTile);

    await waitUntilAsync(
      async () => {
        const stored = await findCharacterById(db, alice.character.id);
        return stored?.mapId === STARTER_WILDS_MAP_ID && stored.x === entry.x;
      },
      5_000,
      'persisted map transfer',
    );
    await waitUntil(
      () => room.state.players.get(alice.character.id) === undefined,
      5_000,
      'removed from the old map',
    );
    await waitUntilAsync(
      async () => (await findCharacterLease(db, alice.character.id)) === undefined,
      5_000,
      'lease released by transfer',
    );
    await room.leave();

    const wildsTicket = await issueTicket(db, alice);
    const wildsRoom = await createWorld(wildsTicket, STARTER_WILDS_MAP_ID);
    const wildsPlayer = await waitForPlayer(wildsRoom, alice.character.id);
    expect(wildsPlayer.x).toBe(entry.x);
    expect(wildsPlayer.y).toBe(entry.y);
    expect(playerCount(wildsRoom)).toBe(1);

    // A character persisted in the wilds cannot enter the town room.
    const wrongMapTicket = await issueTicket(db, alice);
    await expect(createWorld(wrongMapTicket, STARTER_TOWN_MAP_ID)).rejects.toMatchObject({
      code: 525,
    });

    // Walk back onto the return portal.
    const returnTile = { x: 1, y: 16 };
    const backAck = waitForMessage<CommandAck>(wildsRoom, 'command.ack', (body) =>
      commandAckSchema.parse(body),
    );
    wildsRoom.send('move.to', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetTileX: returnTile.x,
      targetTileY: returnTile.y,
    });
    await backAck;

    const inbound = await waitForMessage<SessionTransfer>(
      wildsRoom,
      'session.transfer',
      (payload) => sessionTransferSchema.parse(payload),
    );
    expect(inbound.mapId).toBe(STARTER_TOWN_MAP_ID);

    const townPortalBack = STARTER_WILDS_MAP.portals[0];
    if (townPortalBack === undefined) {
      throw new Error('starter wilds has no portal');
    }
    const backEntry = tileUnits(townPortalBack.targetTile);
    await waitUntilAsync(
      async () => {
        const stored = await findCharacterById(db, alice.character.id);
        return (
          stored?.mapId === STARTER_TOWN_MAP_ID &&
          stored.x === backEntry.x &&
          stored.y === backEntry.y
        );
      },
      5_000,
      'persisted return transfer',
    );
  });
});
