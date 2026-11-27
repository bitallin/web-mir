import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  MONSTER_STATE_CODES,
  PROTOCOL_VERSION,
  combatEventSchema,
  systemNoticeSchema,
  worldRoomNameFor,
  type CombatEvent,
  type SystemNotice,
} from '@web-legend/contracts';
import { RUINED_FIELDS_MAP_ID } from '@web-legend/contracts/maps';
import { WorldState, type WorldStateInstance } from '@web-legend/contracts/world-state';
import { createLogger } from '@web-legend/observability';
import {
  characters,
  createDatabase,
  type Database,
  type DatabaseHandle,
} from '@web-legend/persistence';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { GameServerEnv } from '../src/env';
import { createGameServer, type GameServerRuntime } from '../src/server';
import { createActor, tileUnits, type TestActor } from './worldTestHelpers';

const databaseUrl = process.env.DATABASE_URL;
const BOSS = 'ruins_colossus_1';

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
  return new Promise((resolve, reject) => {
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

describe.runIf(databaseUrl !== undefined)('world_map boss encounter', () => {
  let database: DatabaseHandle;
  let runtime: GameServerRuntime;
  let db: Database;
  let baseUrl: string;
  const clients: Client[] = [];
  const cleanups: (() => Promise<void>)[] = [];

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
      GAME_SERVER_ID: 'game-server-boss-test',
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
        economyRng: () => 0,
        playerRespawnMs: 400,
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

  it('enrages, announces and lets a group defeat the ruins colossus', async () => {
    const positions = [
      { x: 29, y: 33 },
      { x: 31, y: 33 },
      { x: 30, y: 34 },
    ];
    const actors: TestActor[] = [];
    for (const [index, position] of positions.entries()) {
      actors.push(
        await createActor(db, `Boss${String(index)}`, {
          mapId: RUINED_FIELDS_MAP_ID,
          position: tileUnits(position),
          level: 40,
          hp: 800,
          exp: 0,
        }),
      );
    }

    const rooms: WorldRoom[] = [];
    const events: CombatEvent[] = [];
    const notices: SystemNotice[] = [];
    for (const [index, actor] of actors.entries()) {
      const client = new Client(baseUrl);
      clients.push(client);
      const options = { protocolVersion: PROTOCOL_VERSION, ticket: actor.ticket };
      const room = (
        index === 0
          ? await client.create(worldRoomNameFor(RUINED_FIELDS_MAP_ID), options, WorldState)
          : await client.joinById(rooms[0]?.roomId ?? '', options, WorldState)
      ) as WorldRoom;
      cleanups.push(async () => {
        await room.leave();
      });
      room.onMessage('combat.event', (payload: unknown) => {
        events.push(combatEventSchema.parse(payload));
      });
      room.onMessage('system.notice', (payload: unknown) => {
        notices.push(systemNoticeSchema.parse(payload));
      });
      rooms.push(room);
    }

    const leader = rooms[0];
    if (leader === undefined) {
      throw new Error('room was not created');
    }
    await waitUntil(
      () => actors.every((actor) => leader.state.players.has(actor.character.id)),
      10_000,
      'all three players joined',
    );
    await waitUntil(() => leader.state.monsters.get(BOSS) !== undefined, 5_000, 'boss visible');
    const boss = leader.state.monsters.get(BOSS);
    expect(boss?.boss).toBe(true);
    expect(boss?.enraged).toBe(false);
    expect(boss?.maxHp).toBe(5_200);

    for (const [index, room] of rooms.entries()) {
      room.send('combat.autoAttack.start', {
        protocolVersion: PROTOCOL_VERSION,
        commandId: randomUUID(),
        clientSequence: index + 1,
        targetId: BOSS,
      });
    }

    await waitUntil(
      () => events.some((event) => event.kind === 'enrage' && event.entityId === BOSS),
      40_000,
      'boss enrage',
    );
    const enrage = events.find((event) => event.kind === 'enrage' && event.entityId === BOSS);
    expect(enrage).toMatchObject({ entityType: 'monster', maxHp: 5_200 });
    await waitUntil(() => boss?.enraged === true, 5_000, 'boss enraged state');
    expect(notices.some((notice) => notice.message.includes('狂暴'))).toBe(true);

    await waitUntil(
      () =>
        events.some(
          (event) =>
            event.kind === 'death' && event.entityType === 'monster' && event.entityId === BOSS,
        ),
      60_000,
      'boss death',
    );
    const death = events.find(
      (event) =>
        event.kind === 'death' && event.entityType === 'monster' && event.entityId === BOSS,
    );
    const killerId = death?.kind === 'death' ? death.killerId : undefined;
    expect(killerId).toBeTruthy();
    expect(notices.some((notice) => notice.message.includes('击败'))).toBe(true);
    await waitUntil(
      () => leader.state.monsters.get(BOSS)?.state === MONSTER_STATE_CODES.dead,
      5_000,
      'boss dead state',
    );

    await waitUntil(() => leader.state.loot.size > 0, 10_000, 'boss loot drop');
    const templates = [...leader.state.loot].map((entry) => entry[1].templateId);
    expect(templates).toContain('colossus_heart');

    const killer = actors.find((actor) => actor.character.id === killerId);
    if (killer === undefined) {
      throw new Error('killer is not one of the test actors');
    }
    let exp = 0;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [row] = await db
        .select()
        .from(characters)
        .where(eq(characters.id, killer.character.id));
      exp = row?.exp ?? 0;
      if (exp > 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Level 40 needs 1,200 exp for level 41, so the 900 boss exp stays inside
    // the current level and proves the reward reference committed.
    expect(exp).toBe(900);
  }, 120_000);
});
