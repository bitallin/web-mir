import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  PROTOCOL_VERSION,
  STARTER_TOWN_MAP_ID,
  STARTER_WILDS_MAP_ID,
  chatMessageSchema,
  combatEventSchema,
  commandRejectedSchema,
  systemNoticeSchema,
  worldRoomNameFor,
  type TilePoint,
} from '@web-legend/contracts';
import { WorldState, type WorldStateInstance } from '@web-legend/contracts/world-state';
import { createLogger } from '@web-legend/observability';
import {
  assetCommands,
  createDatabase,
  findCharacterById,
  type Database,
  type DatabaseHandle,
} from '@web-legend/persistence';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { GameServerEnv } from '../src/env';
import { createGameServer, type GameServerRuntime } from '../src/server';
import {
  createActor,
  tileUnits,
  type CreateActorOptions,
  type TestActor,
} from './worldTestHelpers';

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
      const port = address.port;
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

type WorldRoom = SdkRoom<unknown, WorldStateInstance>;

function joinOptions(ticket: string): Record<string, unknown> {
  return { protocolVersion: PROTOCOL_VERSION, ticket };
}

function collect<T>(room: WorldRoom, type: string, parse: (payload: unknown) => T): T[] {
  const values: T[] = [];
  room.onMessage(type, (payload: unknown) => {
    values.push(parse(payload));
  });
  return values;
}

function playerHp(room: WorldRoom, playerId: string): number | undefined {
  return room.state.players.get(playerId)?.hp;
}

describe.runIf(databaseUrl !== undefined)('world_map player combat and chat', () => {
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

  async function createWorld(mapId: string, ticket: string): Promise<WorldRoom> {
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

  function actor(
    mapId: string,
    position: TilePoint,
    options: CreateActorOptions = {},
  ): Promise<TestActor> {
    return createActor(db, 'Pvp', { mapId, position: tileUnits(position), ...options });
  }

  function attack(room: WorldRoom, targetId: string, sequence: number): void {
    room.send('combat.basicAttack', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: sequence,
      targetId,
    });
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
      GAME_SERVER_ID: 'game-server-pvp-test',
      GAME_SERVER_REALM: 'classic-01',
      INTERNAL_ADMIN_TOKEN: 'test-internal-admin-token-123',
    };

    runtime = createGameServer({
      env,
      logger: logger(),
      database: db,
      world: {
        reconnectGraceSeconds: 1,
        checkpointIntervalMs: 250,
        combatRng: () => 0.5,
        monsterRespawnMs: 60_000,
        playerRespawnMs: 1_500,
        chatRateCapacity: 4,
        chatRateRefillPerSecond: 2,
        // The wilds map is densely populated for the load scenario; player
        // combat assertions need a room where only the two actors fight.
        monsterSpawns: [],
      },
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

  it('rejects player attacks in the town safe zone without changing hp', async () => {
    const alice = await actor(STARTER_TOWN_MAP_ID, { x: 17, y: 10 });
    const bob = await actor(STARTER_TOWN_MAP_ID, { x: 18, y: 10 });
    const aliceRoom = await createWorld(STARTER_TOWN_MAP_ID, alice.ticket);
    const bobRoom = await joinWorld(aliceRoom.roomId, bob.ticket);

    const rejections = collect(aliceRoom, 'command.rejected', (payload) =>
      commandRejectedSchema.parse(payload),
    );
    const combatEvents = collect(aliceRoom, 'combat.event', (payload) =>
      combatEventSchema.parse(payload),
    );

    await waitUntil(
      () =>
        aliceRoom.state.players.has(alice.character.id) &&
        aliceRoom.state.players.has(bob.character.id),
      5_000,
      'both players joined the town',
    );
    const bobHpBefore = playerHp(bobRoom, bob.character.id);
    expect(bobHpBefore).toBe(120);

    attack(aliceRoom, bob.character.id, 0);

    await waitUntil(
      () => rejections.some((rejection) => rejection.code === 'SAFE_ZONE'),
      5_000,
      'safe zone rejection',
    );
    expect(rejections.find((rejection) => rejection.code === 'SAFE_ZONE')?.message).toContain(
      '安全区',
    );
    expect(combatEvents).toHaveLength(0);
    expect(playerHp(bobRoom, bob.character.id)).toBe(bobHpBefore);
    expect(
      runtime.metrics
        .snapshot()
        .rooms.some((room) => (room.rejectionsByCode['SAFE_ZONE'] ?? 0) > 0),
    ).toBe(true);
  });

  it('allows wilds pvp, broadcasts the kill, revives and grants no reward', async () => {
    const alice = await actor(STARTER_WILDS_MAP_ID, { x: 12, y: 12 });
    // Level 10 with 200 experience makes any wrongly-applied PvE death cost
    // visible; PvP deaths must stay penalty-free (ADR-021).
    const bob = await actor(STARTER_WILDS_MAP_ID, { x: 13, y: 12 }, { hp: 1, level: 10, exp: 200 });
    const aliceRoom = await createWorld(STARTER_WILDS_MAP_ID, alice.ticket);
    const bobRoom = await joinWorld(aliceRoom.roomId, bob.ticket);

    const aliceEvents = collect(aliceRoom, 'combat.event', (payload) =>
      combatEventSchema.parse(payload),
    );
    const bobEvents = collect(bobRoom, 'combat.event', (payload) =>
      combatEventSchema.parse(payload),
    );
    const notices = collect(aliceRoom, 'system.notice', (payload) =>
      systemNoticeSchema.parse(payload),
    );

    await waitUntil(
      () =>
        aliceRoom.state.players.has(alice.character.id) &&
        aliceRoom.state.players.has(bob.character.id),
      5_000,
      'both players joined the wilds',
    );

    const aliceBefore = await findCharacterById(db, alice.character.id);
    expect(aliceBefore?.exp).toBe(0);

    for (let sequence = 0; sequence < 8; sequence += 1) {
      if (bobRoom.state.players.get(bob.character.id)?.alive === false) {
        break;
      }
      attack(aliceRoom, bob.character.id, sequence);
      await new Promise((resolve) => setTimeout(resolve, 950));
    }

    await waitUntil(
      () =>
        bobEvents.some((event) => event.kind === 'death' && event.entityId === bob.character.id),
      5_000,
      'pvp death event',
    );
    const death = bobEvents.find(
      (event) => event.kind === 'death' && event.entityId === bob.character.id,
    );
    expect(death?.kind).toBe('death');
    if (death?.kind !== 'death') {
      return;
    }
    expect(death.killerId).toBe(alice.character.id);
    expect(death.reviveInMs).toBe(1_500);
    expect(bobRoom.state.players.get(bob.character.id)?.alive).toBe(false);

    const killNotice = notices.find(
      (notice) => notice.message.includes('击败') && notice.message.includes(alice.character.name),
    );
    expect(killNotice?.kind).toBe('warning');

    await waitUntil(
      () =>
        bobEvents.some((event) => event.kind === 'respawn' && event.entityId === bob.character.id),
      5_000,
      'pvp respawn event',
    );
    await waitUntil(
      () => bobRoom.state.players.get(bob.character.id)?.alive === true,
      2_000,
      'player state revived',
    );
    const revived = bobRoom.state.players.get(bob.character.id);
    expect(revived?.hp).toBe(revived?.maxHp);

    const aliceAfter = await findCharacterById(db, alice.character.id);
    expect(aliceAfter?.exp).toBe(aliceBefore?.exp);

    // The asset queue is otherwise idle here, so a PvE-style death penalty
    // would have committed long before the 1.5s respawn completed.
    const bobAfter = await findCharacterById(db, bob.character.id);
    expect(bobAfter?.level).toBe(10);
    expect(bobAfter?.exp).toBe(200);
    const penaltyCommands = await db
      .select()
      .from(assetCommands)
      .where(
        and(
          eq(assetCommands.characterId, bob.character.id),
          eq(assetCommands.kind, 'death_penalty'),
        ),
      );
    expect(penaltyCommands).toHaveLength(0);
    expect(
      aliceEvents.some((event) => event.kind === 'death' && event.entityType === 'monster'),
    ).toBe(false);
    expect(runtime.metrics.snapshot().rooms.some((room) => room.pvpKills >= 1)).toBe(true);
  });

  it('enforces chat rate limits and blocks links with a system warning', async () => {
    const alice = await actor(STARTER_TOWN_MAP_ID, { x: 17, y: 10 });
    const bob = await actor(STARTER_TOWN_MAP_ID, { x: 18, y: 10 });
    const aliceRoom = await createWorld(STARTER_TOWN_MAP_ID, alice.ticket);
    const bobRoom = await joinWorld(aliceRoom.roomId, bob.ticket);

    const chatMessages = collect(bobRoom, 'chat.message', (payload) =>
      chatMessageSchema.parse(payload),
    );
    const rejections = collect(aliceRoom, 'command.rejected', (payload) =>
      commandRejectedSchema.parse(payload),
    );
    const aliceNotices = collect(aliceRoom, 'system.notice', (payload) =>
      systemNoticeSchema.parse(payload),
    );

    await waitUntil(
      () =>
        aliceRoom.state.players.has(alice.character.id) &&
        aliceRoom.state.players.has(bob.character.id),
      5_000,
      'both players joined the town',
    );

    for (let index = 0; index < 5; index += 1) {
      aliceRoom.send('chat.send', {
        protocolVersion: PROTOCOL_VERSION,
        clientMessageId: randomUUID(),
        message: `测试消息 ${String(index)}`,
      });
    }

    await waitUntil(
      () => rejections.some((rejection) => rejection.code === 'RATE_LIMITED'),
      5_000,
      'chat rate limit rejection',
    );
    await waitUntil(() => chatMessages.length === 4, 5_000, 'four accepted chat messages');
    expect(chatMessages).toHaveLength(4);

    // Let the bucket refill before checking content filtering.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const beforeFilter = chatMessages.length;
    aliceRoom.send('chat.send', {
      protocolVersion: PROTOCOL_VERSION,
      clientMessageId: randomUUID(),
      message: '访问 www.example.com 领取奖励',
    });

    await waitUntil(
      () =>
        aliceNotices.some((notice) => notice.kind === 'warning' && notice.message.includes('链接')),
      5_000,
      'chat filter warning',
    );
    expect(chatMessages).toHaveLength(beforeFilter);
    expect(runtime.metrics.snapshot().rooms.some((room) => room.chatFiltered >= 1)).toBe(true);
  });
});
