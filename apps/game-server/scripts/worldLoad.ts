import { randomUUID } from 'node:crypto';
import { get } from 'node:http';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import { createOpaqueToken, hashToken } from '@web-legend/auth';
import {
  GAME_TICKET_TTL_SECONDS,
  PROTOCOL_VERSION,
  STARTER_TOWN_MAP_ID,
  TILE_UNITS,
  worldRoomNameFor,
} from '@web-legend/contracts';
import { STARTER_TOWN_MAP } from '@web-legend/contracts/maps';
import { WorldState, type WorldStateInstance } from '@web-legend/contracts/world-state';
import {
  createDatabase,
  insertAccount,
  insertCharacter,
  insertGameTicket,
  realms,
} from '@web-legend/persistence';
import { z } from 'zod';

import { loadGameServerEnv } from '../src/env';

/**
 * Operational load check for the phase-3 acceptance target: N virtual players
 * join the starter town, keep moving, and the room's tick metrics are read back
 * from `/metrics`. It uses real accounts, characters, tickets and leases.
 */

type LoadOptions = {
  players: number;
  durationMs: number;
  moveIntervalMs: number;
  gameServerPort: number;
  databaseUrl: string;
};

function readOptions(): LoadOptions {
  const env = loadGameServerEnv();
  const players = Number(process.env['LOAD_PLAYERS'] ?? '30');
  const durationMs = Number(process.env['LOAD_DURATION_MS'] ?? '10000');
  const moveIntervalMs = Number(process.env['LOAD_MOVE_INTERVAL_MS'] ?? '400');
  if (!Number.isInteger(players) || players < 1 || players > 45) {
    throw new Error('LOAD_PLAYERS must be between 1 and 45');
  }
  return {
    players,
    durationMs,
    moveIntervalMs,
    gameServerPort: env.GAME_SERVER_PORT,
    databaseUrl: env.DATABASE_URL,
  };
}

function randomSuffix(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

/**
 * Walkable tiles reachable from the first spawn, excluding portal tiles: a
 * random walk that crosses a portal would legitimately transfer that player to
 * the other map and make the one-room measurement ambiguous.
 */
function walkableTiles(): { x: number; y: number }[] {
  const map = STARTER_TOWN_MAP;
  const portalKeys = new Set(
    map.portals.map((portal) => `${String(portal.tile.x)}:${String(portal.tile.y)}`),
  );
  const start = map.spawnPoints[0];
  if (start === undefined) {
    throw new Error('starter town has no spawn point');
  }

  const reachable = new Set<string>([`${String(start.x)}:${String(start.y)}`]);
  const queue = [start];
  const dirs = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === undefined) {
      break;
    }
    for (const dir of dirs) {
      const next = { x: current.x + dir.x, y: current.y + dir.y };
      const key = `${String(next.x)}:${String(next.y)}`;
      if (reachable.has(key)) {
        continue;
      }
      if (
        next.x < 0 ||
        next.y < 0 ||
        next.x >= map.width ||
        next.y >= map.height ||
        map.layers.collision[next.y * map.width + next.x] !== 0
      ) {
        continue;
      }
      reachable.add(key);
      queue.push(next);
    }
  }

  return (
    [...reachable]
      .filter((key) => !portalKeys.has(key))
      // A path may cross the portal tile even when neither endpoint is the
      // portal, so stay west of it for the duration of the measurement.
      .filter((key) => Number(key.split(':')[0]) <= 34)
      .map((key) => {
        const [x, y] = key.split(':');
        return { x: Number(x), y: Number(y) };
      })
  );
}

function pickTarget(
  tiles: readonly { x: number; y: number }[],
  random: () => number,
): { x: number; y: number } {
  const tile = tiles[Math.floor(random() * tiles.length)];
  if (tile === undefined) {
    throw new Error('load map has no walkable tile');
  }
  return tile;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const metricsBodySchema = z
  .object({
    rooms: z.array(
      z
        .object({
          roomId: z.string(),
          players: z.number().int().nonnegative(),
          acceptedCommands: z.number().int().nonnegative(),
          rejectedCommands: z.number().int().nonnegative(),
          tick: z.object({
            samples: z.number().int().nonnegative(),
            p50Ms: z.number().nonnegative(),
            p95Ms: z.number().nonnegative(),
            p99Ms: z.number().nonnegative(),
            maxMs: z.number().nonnegative(),
          }),
        })
        .loose(),
    ),
    totals: z.object({
      acceptedCommands: z.number().int().nonnegative(),
      rejectedCommands: z.number().int().nonnegative(),
    }),
  })
  .loose();

/** `fetch` refuses port 87 (a WHATWG bad port), so read metrics over node:http. */
function readJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`metrics endpoint returned ${String(response.statusCode)}`));
          return;
        }
        try {
          resolve(JSON.parse(body) as unknown);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }).on('error', reject);
  });
}

async function main(): Promise<void> {
  const options = readOptions();
  const database = createDatabase(options.databaseUrl, { max: 4 });
  const tiles = walkableTiles();
  const random = Math.random;
  const baseUrl = `http://127.0.0.1:${String(options.gameServerPort)}`;
  // Node's fetch (and therefore the Colyseus SDK's matchmaking) refuses port
  // 87 as a WHATWG "bad port". The browser reaches the server through Vite's
  // same-origin /ws proxy, so the load client does the same.
  const clientUrl =
    process.env['LOAD_CLIENT_URL'] ?? `ws://127.0.0.1:${process.env['GAME_WEB_PORT'] ?? '84'}/ws`;
  const roomName = worldRoomNameFor(STARTER_TOWN_MAP_ID);

  await database.db
    .insert(realms)
    .values({ code: 'classic-01', name: '经典一区', status: 'active' })
    .onConflictDoNothing({ target: realms.code });
  const [realm] = await database.db.select({ id: realms.id }).from(realms).limit(1);
  if (realm === undefined) {
    throw new Error('load test needs an active realm');
  }

  const clients: Client[] = [];
  const rooms: SdkRoom<unknown, WorldStateInstance>[] = [];
  let accepted = 0;
  let rejected = 0;

  process.stdout.write(
    `load: ${String(options.players)} players, ${String(options.durationMs / 1_000)}s, ` +
      `room ${roomName}, client ${clientUrl}, metrics ${baseUrl}\n`,
  );

  try {
    for (let index = 0; index < options.players; index += 1) {
      const suffix = `${randomSuffix()}${String(index)}`;
      const account = await insertAccount(database.db, {
        username: `load_${suffix}`.slice(0, 24),
        usernameNormalized: `load_${suffix}`.slice(0, 24),
        passwordHash: 'load-test-only-hash',
      });
      const spawn = pickTarget(tiles, random);
      const character = await insertCharacter(database.db, {
        accountId: account.id,
        realmId: realm.id,
        name: `L${suffix}`.slice(0, 12),
        nameNormalized: `l${suffix}`.slice(0, 12),
        classId: 'warrior',
        level: 1,
        exp: 0,
        hp: 120,
        maxHp: 120,
        mp: 30,
        maxMp: 30,
        mapId: STARTER_TOWN_MAP_ID,
        x: spawn.x * TILE_UNITS + TILE_UNITS / 2,
        y: spawn.y * TILE_UNITS + TILE_UNITS / 2,
        facing: 2,
      });

      const ticket = createOpaqueToken();
      await insertGameTicket(database.db, {
        tokenHash: hashToken(ticket),
        accountId: account.id,
        characterId: character.id,
        realmId: realm.id,
        expiresAt: new Date(Date.now() + GAME_TICKET_TTL_SECONDS * 1_000),
      });

      const client = new Client(clientUrl);
      clients.push(client);
      const room = (await client.joinOrCreate(
        roomName,
        { protocolVersion: PROTOCOL_VERSION, ticket },
        WorldState,
      )) as SdkRoom<unknown, WorldStateInstance>;
      rooms.push(room);
      room.onMessage('command.ack', () => {
        accepted += 1;
      });
      room.onMessage('command.rejected', () => {
        rejected += 1;
      });
      // Load clients only measure movement, but the server sends a profile on
      // join; consume it so the SDK does not warn about an unhandled message.
      room.onMessage('combat.profile', () => undefined);
      room.onMessage('inventory.snapshot', () => undefined);
      room.onMessage('system.notice', () => undefined);
      room.onMessage('shop.catalog', () => undefined);
    }

    const startedAt = Date.now();
    let sequence = 0;
    while (Date.now() - startedAt < options.durationMs) {
      for (const room of rooms) {
        const target = pickTarget(tiles, random);
        room.send('move.to', {
          protocolVersion: PROTOCOL_VERSION,
          commandId: randomUUID(),
          clientSequence: sequence,
          targetTileX: target.x,
          targetTileY: target.y,
        });
      }
      sequence += 1;
      await wait(options.moveIntervalMs);
    }

    await wait(1_000);
    const body = metricsBodySchema.parse(await readJson(`${baseUrl}/metrics`));

    const roomMetrics = [...body.rooms].sort((left, right) => right.players - left.players)[0];
    if (roomMetrics === undefined) {
      throw new Error('no room metrics were reported');
    }

    process.stdout.write(
      `joined ${String(rooms.length)}/${String(options.players)} clients ` +
        `accepted=${String(accepted)} rejected=${String(rejected)}\n`,
    );
    process.stdout.write(
      `room ${roomMetrics.roomId}: players=${String(roomMetrics.players)} ` +
        `tick p50=${String(roomMetrics.tick.p50Ms)}ms p95=${String(roomMetrics.tick.p95Ms)}ms ` +
        `p99=${String(roomMetrics.tick.p99Ms)}ms max=${String(roomMetrics.tick.maxMs)}ms ` +
        `samples=${String(roomMetrics.tick.samples)}\n`,
    );

    if (rooms.length < options.players) {
      throw new Error('not every virtual player joined the room');
    }
    if (roomMetrics.players < options.players) {
      throw new Error('the room did not report all virtual players');
    }
    if (accepted === 0) {
      throw new Error('no movement command was accepted');
    }
    if (roomMetrics.tick.p95Ms >= 25) {
      throw new Error(`tick p95 ${String(roomMetrics.tick.p95Ms)}ms exceeds the 25ms target`);
    }
  } finally {
    await Promise.allSettled(rooms.map(async (room) => room.leave()));
    await database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`world load check failed: ${message}\n`);
  process.exitCode = 1;
});
