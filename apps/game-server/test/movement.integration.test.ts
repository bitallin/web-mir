import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  PROTOCOL_VERSION,
  STARTER_WILDS_MAP_ID,
  combatTargetChangedSchema,
  worldRoomNameFor,
  type CombatTargetChanged,
} from '@web-legend/contracts';
import { WorldState, type WorldStateInstance } from '@web-legend/contracts/world-state';
import { createLogger } from '@web-legend/observability';
import { createDatabase, type Database, type DatabaseHandle } from '@web-legend/persistence';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { GameServerEnv } from '../src/env';
import { createGameServer, type GameServerRuntime } from '../src/server';
import { createActor, tileUnits } from './worldTestHelpers';

const databaseUrl = process.env.DATABASE_URL;
const SLIME = {
  id: 'smooth_slime_1',
  monsterId: 'wild_slime',
  tile: { x: 14, y: 16 },
};
const START = { x: 2, y: 16 };

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

describe.runIf(databaseUrl !== undefined)('world_map movement smoothness', () => {
  let database: DatabaseHandle;
  let runtime: GameServerRuntime;
  let db: Database;
  let baseUrl: string;
  let sequence = 0;
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
      GAME_SERVER_ID: 'game-server-movement-test',
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
        monsterSpawns: [SLIME],
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

  async function join(start: {
    x: number;
    y: number;
  }): Promise<{ room: WorldRoom; characterId: string }> {
    const actor = await createActor(db, 'Move', {
      mapId: STARTER_WILDS_MAP_ID,
      position: tileUnits(start),
      level: 1,
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
    await waitUntil(() => room.state.players.has(actor.character.id), 10_000, 'player joined');
    return { room, characterId: actor.character.id };
  }

  function nextCommand(): { commandId: string; clientSequence: number } {
    sequence += 1;
    return { commandId: randomUUID(), clientSequence: sequence };
  }

  it('approaches a locked target without stepping backwards', async () => {
    const { room, characterId: selfId } = await join(START);
    const pathUpdates: CombatTargetChanged[] = [];
    room.onMessage('combat.target.changed', (payload: unknown) => {
      pathUpdates.push(combatTargetChangedSchema.parse(payload));
    });

    room.send('combat.autoAttack.start', {
      protocolVersion: PROTOCOL_VERSION,
      ...nextCommand(),
      targetId: SLIME.id,
    });

    await waitUntil(
      () =>
        pathUpdates.some((update) => update.reason === 'approaching' && update.path !== undefined),
      5_000,
      'approach path',
    );
    const approach = pathUpdates.find(
      (update) => update.reason === 'approaching' && update.path !== undefined,
    );
    expect(approach?.path?.length).toBeGreaterThan(0);
    expect(approach?.speedUnitsPerSecond).toBe(4_000);

    const samples: number[] = [];
    for (let index = 0; index < 60; index += 1) {
      const x = room.state.players.get(selfId)?.x;
      if (x !== undefined) {
        samples.push(x);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(samples.length).toBeGreaterThan(10);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1] ?? 0);
    }
    expect(samples[samples.length - 1]).toBeGreaterThan((samples[0] ?? 0) + 4_000);
  }, 30_000);

  it('retargets mid-tile without pulling the player back to the tile center', async () => {
    const { room, characterId: selfId } = await join(START);

    room.send('move.to', {
      protocolVersion: PROTOCOL_VERSION,
      ...nextCommand(),
      targetTileX: 10,
      targetTileY: 16,
    });
    await waitUntil(
      () => (room.state.players.get(selfId)?.x ?? 0) > tileUnits({ x: 4, y: 16 }).x,
      5_000,
      'first leg started',
    );

    // Retarget while the authoritative position is between tile centers.
    room.send('move.to', {
      protocolVersion: PROTOCOL_VERSION,
      ...nextCommand(),
      targetTileX: 13,
      targetTileY: 16,
    });

    const samples: number[] = [];
    for (let index = 0; index < 50; index += 1) {
      const x = room.state.players.get(selfId)?.x;
      if (x !== undefined) {
        samples.push(x);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1] ?? 0);
    }
    expect(Math.max(...samples)).toBeGreaterThan(tileUnits({ x: 11, y: 16 }).x);
  }, 30_000);
});
