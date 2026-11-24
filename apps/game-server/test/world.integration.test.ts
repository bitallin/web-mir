import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  commandAckSchema,
  commandRejectedSchema,
  PROTOCOL_VERSION,
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
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { GameServerEnv } from '../src/env';
import { createGameServer, type GameServerRuntime } from '../src/server';

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

function joinOptions(displayName: string, playerKey = randomUUID()): Record<string, unknown> {
  return { protocolVersion: PROTOCOL_VERSION, displayName, playerKey };
}

function playerTile(room: WorldRoom, playerId: string): { x: number; y: number } | undefined {
  const player = room.state.players.get(playerId);
  if (player === undefined) {
    return undefined;
  }
  return { x: Math.floor(player.x / 1_000), y: Math.floor(player.y / 1_000) };
}

function playerCount(room: WorldRoom): number {
  return room.state.players.size;
}

async function firstPlayer(room: WorldRoom): Promise<PlayerStateInstance> {
  await waitUntil(() => room.state.players.size > 0, 5_000, 'self player');
  const player = [...room.state.players.values()][0];
  if (player === undefined) {
    throw new Error('Player list was unexpectedly empty');
  }
  return player;
}

describe('world_map room', () => {
  let runtime: GameServerRuntime;
  let baseUrl: string;
  const cleanups: (() => Promise<void>)[] = [];
  const clients: Client[] = [];

  function client(): Client {
    const instance = new Client(baseUrl);
    clients.push(instance);
    return instance;
  }

  async function createWorld(displayName: string, playerKey = randomUUID()): Promise<WorldRoom> {
    const room = (await client().create(
      WORLD_ROOM_NAME,
      joinOptions(displayName, playerKey),
      WorldState,
    )) as WorldRoom;
    cleanups.push(async () => {
      await room.leave();
    });
    return room;
  }

  async function joinWorld(
    roomId: string,
    displayName: string,
    playerKey = randomUUID(),
  ): Promise<WorldRoom> {
    const room = (await client().joinById(
      roomId,
      joinOptions(displayName, playerKey),
      WorldState,
    )) as WorldRoom;
    cleanups.push(async () => {
      await room.leave();
    });
    return room;
  }

  beforeAll(async () => {
    const port = await reservePort();
    const env: GameServerEnv = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      GAME_SERVER_HOST: '127.0.0.1',
      GAME_SERVER_PORT: port,
    };

    runtime = createGameServer({
      env,
      logger: logger(),
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
  });

  it('lets two clients see each other with distinct authoritative spawns', async () => {
    const alice = await createWorld('Alice');
    const bob = await joinWorld(alice.roomId, 'Bob');

    await waitUntil(
      () => playerCount(alice) === 2 && playerCount(bob) === 2,
      5_000,
      'both players visible',
    );

    expect(alice.state.mapId).toBe('phase1_test_map');
    expect(alice.state.tickHz).toBe(20);

    const names = [...bob.state.players.values()].map((player) => player.displayName).sort();
    expect(names).toEqual(['Alice', 'Bob']);

    const aliceView = [...bob.state.players.values()].find(
      (player) => player.displayName === 'Alice',
    );
    const bobView = [...alice.state.players.values()].find(
      (player) => player.displayName === 'Bob',
    );
    expect(aliceView?.connected).toBe(true);
    expect(bobView).toBeDefined();
    expect(aliceView?.x).not.toBe(bobView?.x ?? aliceView?.x);
  });

  it('applies an intent server-side and shows it to the other client within 250ms', async () => {
    const alice = await createWorld('Alice');
    const bob = await joinWorld(alice.roomId, 'Bob');
    await waitUntil(() => playerCount(bob) === 2, 5_000, 'both players visible');

    const alicePlayer = [...alice.state.players.values()].find(
      (player) => player.displayName === 'Alice',
    );
    expect(alicePlayer).toBeDefined();
    if (alicePlayer === undefined) {
      return;
    }

    const start = { x: alicePlayer.x, y: alicePlayer.y };
    const startTile = playerTile(alice, alicePlayer.playerId);
    expect(startTile).toBeDefined();
    if (startTile === undefined) {
      return;
    }

    const target = { x: startTile.x + 2, y: startTile.y };
    const ackPromise = waitForMessage<CommandAck>(alice, 'command.ack', (payload) =>
      commandAckSchema.parse(payload),
    );

    const clickedAt = performance.now();
    alice.send('move.to', {
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
        const view = bob.state.players.get(alicePlayer.playerId);
        return view !== undefined && view.x !== start.x;
      },
      2_000,
      'remote player movement',
    );
    const visibleAfterMs = performance.now() - clickedAt;

    expect(visibleAfterMs).toBeLessThan(250);

    await waitUntil(
      () => playerTile(bob, alicePlayer.playerId)?.x === target.x,
      2_000,
      'movement to finish',
    );
    expect(playerTile(alice, alicePlayer.playerId)).toEqual(target);
  });

  it('rejects forged payloads, wrong protocols and illegal or unreachable targets', async () => {
    const room = await createWorld('Alice');
    const self = await firstPlayer(room);
    const start = { x: self.x, y: self.y };
    const tile = playerTile(room, self.playerId);
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

    expect(room.state.players.get(self.playerId)?.x).toBe(start.x);
    expect(room.state.players.get(self.playerId)?.y).toBe(start.y);
  });

  it('deduplicates command ids and rejects stale sequences', async () => {
    const room = await createWorld('Alice');
    const self = await firstPlayer(room);
    const tile = playerTile(room, self.playerId);
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
    const room = await createWorld('Alice');
    const self = await firstPlayer(room);
    const tile = playerTile(room, self.playerId);
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
    const room = await createWorld('Alice');
    const self = await firstPlayer(room);
    const playerId = self.playerId;
    const sessionId = room.sessionId;
    room.reconnection.minUptime = 0;
    room.reconnection.minDelay = 100;
    room.reconnection.maxDelay = 300;

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
    expect((await ack).path.length).toBeGreaterThan(0);
  });

  it('removes the player after the reconnect grace period expires', async () => {
    const room = await createWorld('Alice');
    const observer = await joinWorld(room.roomId, 'Bob');
    await waitUntil(() => playerCount(observer) === 2, 5_000, 'both players visible');

    const aliceId = [...room.state.players.values()].find(
      (player) => player.displayName === 'Alice',
    )?.playerId;
    expect(aliceId).toBeDefined();
    if (aliceId === undefined) {
      return;
    }

    room.reconnection.enabled = false;
    room.connection.close();

    await waitUntil(
      () => observer.state.players.get(aliceId) === undefined,
      5_000,
      'dropped player cleanup',
    );
    expect(playerCount(observer)).toBe(1);
  });

  it('exposes tick, player and command metrics', async () => {
    const room = await createWorld('Alice');
    const self = await firstPlayer(room);
    const tile = playerTile(room, self.playerId);
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
});
