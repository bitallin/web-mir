import { createServer as createNetServer } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  PROTOCOL_VERSION,
  STARTER_WILDS_MAP_ID,
  combatEventSchema,
  worldRoomNameFor,
  type CombatEvent,
} from '@web-legend/contracts';
import { WorldState, type WorldStateInstance } from '@web-legend/contracts/world-state';
import { createLogger } from '@web-legend/observability';
import { createDatabase, type Database, type DatabaseHandle } from '@web-legend/persistence';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { GameServerEnv } from '../src/env';
import { createGameServer, type GameServerRuntime } from '../src/server';
import { createActor, tileUnits } from './worldTestHelpers';

const databaseUrl = process.env.DATABASE_URL;
const ALPHA = 'test_alpha';
const ALPHA_SPAWN = {
  id: ALPHA,
  monsterId: 'alpha_wolf',
  tile: { x: 4, y: 16 },
};

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

function collectCombatEvents(room: WorldRoom): CombatEvent[] {
  const events: CombatEvent[] = [];
  room.onMessage('combat.event', (payload: unknown) => {
    events.push(combatEventSchema.parse(payload));
  });
  return events;
}

describe.runIf(databaseUrl !== undefined)('world_map monster threat', () => {
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
      GAME_SERVER_ID: 'game-server-threat-test',
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
        playerRespawnMs: 400,
        monsterSpawns: [ALPHA_SPAWN],
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

  it('routes the telegraphed pounce and resolves it on the server tick', async () => {
    const actor = await createActor(db, 'Threat', {
      mapId: STARTER_WILDS_MAP_ID,
      position: tileUnits({ x: 2, y: 16 }),
    });
    const client = new Client(baseUrl);
    clients.push(client);
    const room = (await client.create(
      worldRoomNameFor(STARTER_WILDS_MAP_ID),
      { protocolVersion: PROTOCOL_VERSION, ticket: actor.ticket },
      WorldState,
    )) as WorldRoom;
    cleanups.push(async () => {
      await room.leave();
    });
    const events = collectCombatEvents(room);

    await waitUntil(
      () => events.some((event) => event.kind === 'telegraph' && event.sourceId === ALPHA),
      5_000,
      'telegraph',
    );
    const telegraph = events.find(
      (event) => event.kind === 'telegraph' && event.sourceId === ALPHA,
    );
    expect(telegraph).toMatchObject({
      targetId: actor.character.id,
      radiusTiles: 1.5,
      impactInMs: 900,
      x: 2 * 1_000 + 500,
      y: 16 * 1_000 + 500,
    });
    expect(events.some((event) => event.kind === 'hit' && event.sourceId === ALPHA)).toBe(false);

    await waitUntil(
      () => events.some((event) => event.kind === 'hit' && event.sourceId === ALPHA),
      5_000,
      'telegraphed hit',
    );
    const hit = events.find((event) => event.kind === 'hit' && event.sourceId === ALPHA);
    expect(hit).toMatchObject({ targetId: actor.character.id, targetType: 'player' });
  });
});
