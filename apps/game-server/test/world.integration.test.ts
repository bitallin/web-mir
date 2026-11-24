import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  commandAckSchema,
  commandRejectedSchema,
  PROTOCOL_VERSION,
  TILE_UNITS,
  WORLD_ROOM_NAME,
  type CommandAck,
  type CommandRejected,
} from '@web-legend/contracts';
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
import { createActor, issueTicket, type TestActor } from './worldTestHelpers';

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

  async function createWorld(ticket: string): Promise<WorldRoom> {
    const room = (await client().create(
      WORLD_ROOM_NAME,
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
      world: { reconnectGraceSeconds: 1 },
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

    expect(aliceRoom.state.mapId).toBe('phase1_test_map');
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
      targetTileX: 23,
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
  });
});
