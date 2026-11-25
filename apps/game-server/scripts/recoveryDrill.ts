/**
 * Game Server restart drill (ADR-023).
 *
 * Scenario A: SIGTERM (normal restart). The server checkpoints on dispose;
 * the character rejoins at the saved position with committed items intact.
 * Scenario B: SIGKILL (crash). Only the 20s periodic checkpoint survives; the
 * character rejoins after the lease expires and committed assets are intact.
 *
 * The drill spawns real server processes against PostgreSQL and uses real game
 * tickets; nothing is mocked.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';

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
import { eq } from 'drizzle-orm';
import {
  createDatabase,
  findCharacterById,
  insertAccount,
  insertCharacterWithItems,
  insertGameTicket,
  realms,
  type DatabaseHandle,
} from '@web-legend/persistence';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
// pnpm runs this script with cwd=apps/game-server; the shared file is at the
// repository root.
const ENV_FILE = join(SERVER_DIR, '..', '..', '.env');
if (existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
}
const TOKEN = 'recovery-drill-internal-token-123';
const SERVER_ID = 'recovery-drill';

type Evidence = {
  scenario: string;
  characterId: string;
  joinPosition: { x: number; y: number } | null;
  movedPosition: { x: number; y: number } | null;
  rejoinPosition: { x: number; y: number } | null;
  persistedPosition: { x: number; y: number } | null;
  itemInstances: { before: number; after: number };
  leaseWaitMs: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reservePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('failed to reserve a port'));
        return;
      }
      const { port } = address;
      probe.close((error) => (error === undefined ? resolve(port) : reject(error)));
    });
  });
}

async function waitForHealth(port: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await new Promise<boolean>((resolve) => {
      const request = get(`http://127.0.0.1:${String(port)}/health/live`, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      request.on('error', () => resolve(false));
      request.setTimeout(1000, () => {
        request.destroy();
        resolve(false);
      });
    });
    if (ok) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error('game server did not become healthy');
    }
    await sleep(200);
  }
}

async function waitUntil<T>(
  label: string,
  check: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await sleep(100);
  }
}

type ServerChild = { process: ChildProcess; port: number };

async function startServer(port: number, databaseUrl: string): Promise<ServerChild> {
  // Run the built server exactly as production does: a tsx wrapper would sit
  // between the signal and the process, so the drill could neither prove a
  // graceful SIGTERM nor a real crash. Run `pnpm build` before the drill.
  if (!existsSync(join(SERVER_DIR, 'dist', 'index.js'))) {
    throw new Error('dist/index.js is missing; run `pnpm build` before the recovery drill');
  }
  // detached makes the server its own process-group leader so SIGKILL reaches
  // the whole tree rather than just one wrapper process.
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: SERVER_DIR,
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      GAME_SERVER_HOST: '127.0.0.1',
      GAME_SERVER_PORT: String(port),
      GAME_SERVER_ID: SERVER_ID,
      GAME_SERVER_REALM: 'classic-01',
      INTERNAL_ADMIN_TOKEN: TOKEN,
      DATABASE_URL: databaseUrl,
    },
    stdio: 'ignore',
  });
  await waitForHealth(port);
  return { process: child, port };
}

async function stopServer(server: ServerChild, signal: NodeJS.Signals): Promise<void> {
  const exited = new Promise<void>((resolve) => {
    if (server.process.exitCode !== null || server.process.signalCode !== null) {
      resolve();
      return;
    }
    server.process.once('exit', () => resolve());
  });
  if (server.process.pid !== undefined) {
    try {
      process.kill(-server.process.pid, signal);
    } catch {
      server.process.kill(signal);
    }
  }
  await Promise.race([exited, sleep(15_000)]);
}

async function createDrillCharacter(
  database: DatabaseHandle,
): Promise<{ characterId: string; accountId: string }> {
  await database.db
    .insert(realms)
    .values({ code: 'classic-01', name: '经典一区', status: 'active' })
    .onConflictDoNothing({ target: realms.code });
  const [realm] = await database.db
    .select({ id: realms.id })
    .from(realms)
    .where(eqCode('classic-01'))
    .limit(1);
  if (realm === undefined) {
    throw new Error('classic-01 realm is unavailable');
  }
  const suffix = randomUUID().replace(/-/gu, '').slice(0, 8);
  const account = await insertAccount(database.db, {
    username: `drill_${suffix}`.slice(0, 24),
    usernameNormalized: `drill_${suffix}`.slice(0, 24),
    passwordHash: 'recovery-drill-only-hash',
  });
  const spawn = STARTER_TOWN_MAP.spawnPoints[0];
  if (spawn === undefined) {
    throw new Error('starter town has no spawn point');
  }
  const character = await insertCharacterWithItems(
    database.db,
    {
      accountId: account.id,
      realmId: realm.id,
      name: `D${suffix}`.slice(0, 12),
      nameNormalized: `d${suffix}`.slice(0, 12),
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
    },
    [
      { templateId: 'warrior_sword', quantity: 1 },
      { templateId: 'small_hp_potion', quantity: 3 },
    ],
  );
  return { characterId: character.id, accountId: account.id };
}

function eqCode(code: string) {
  return eq(realms.code, code);
}

async function issueTicket(
  database: DatabaseHandle,
  accountId: string,
  characterId: string,
): Promise<string> {
  const ticket = createOpaqueToken();
  const [row] = await database.db
    .select({ realmId: realms.id })
    .from(realms)
    .where(eqCode('classic-01'))
    .limit(1);
  if (row === undefined) {
    throw new Error('realm missing');
  }
  await insertGameTicket(database.db, {
    tokenHash: hashToken(ticket),
    accountId,
    characterId,
    realmId: row.realmId,
    expiresAt: new Date(Date.now() + GAME_TICKET_TTL_SECONDS * 1000),
  });
  return ticket;
}

async function joinRoom(
  port: number,
  ticket: string,
): Promise<SdkRoom<unknown, WorldStateInstance>> {
  const client = new Client(`http://127.0.0.1:${String(port)}`);
  const room = (await client.joinOrCreate(
    worldRoomNameFor(STARTER_TOWN_MAP_ID),
    { protocolVersion: PROTOCOL_VERSION, ticket },
    WorldState,
  )) as SdkRoom<unknown, WorldStateInstance>;
  // The drill restarts the server deliberately; the SDK's own retry loop would
  // race the rejoin that the drill performs with a fresh ticket.
  room.reconnection.enabled = false;
  return room;
}

async function countItems(database: DatabaseHandle, characterId: string): Promise<number> {
  const rows = await database.sql.unsafe<{ value: number }[]>(
    `select count(*)::int as value from item_instances where character_id = $1`,
    [characterId],
  );
  return rows[0]?.value ?? 0;
}

async function runScenario(
  database: DatabaseHandle,
  databaseUrl: string,
  scenario: 'sigterm' | 'sigkill',
): Promise<Evidence> {
  const port = await reservePort();
  const { characterId, accountId } = await createDrillCharacter(database);
  const itemsBefore = await countItems(database, characterId);

  let server = await startServer(port, databaseUrl);
  let room = await joinRoom(port, await issueTicket(database, accountId, characterId));
  const joined = await waitUntil('player join', () => room.state.players.get(characterId));
  const joinPosition = { x: joined.x, y: joined.y };

  const target = STARTER_TOWN_MAP.spawnPoints[1] ?? STARTER_TOWN_MAP.spawnPoints[0]!;
  room.send('move.to', {
    protocolVersion: PROTOCOL_VERSION,
    commandId: randomUUID(),
    clientSequence: 1,
    targetTileX: target.x,
    targetTileY: target.y,
  });
  await sleep(2_000);
  const moved = room.state.players.get(characterId)!;
  const movedPosition = { x: moved.x, y: moved.y };

  if (scenario === 'sigkill') {
    // The room's 20s checkpoint timer starts when the room is created, while
    // each session's throttle starts at join; the first periodic save for this
    // session therefore lands at the second timer tick (t+40s). Wait past it
    // so the crash proves data persisted by the periodic checkpoint.
    await sleep(45_000);
  }

  await stopServer(server, scenario === 'sigterm' ? 'SIGTERM' : 'SIGKILL');

  const persisted = await findCharacterById(database.db, characterId);
  if (persisted === undefined) {
    throw new Error('character disappeared during the drill');
  }

  const leaseWaitStart = Date.now();
  let leaseFree = false;
  while (Date.now() - leaseWaitStart < 40_000) {
    const leases = await database.sql.unsafe<{ value: number }[]>(
      `select count(*)::int as value from character_sessions
        where character_id = $1 and lease_expires_at > now()`,
      [characterId],
    );
    if ((leases[0]?.value ?? 0) === 0) {
      leaseFree = true;
      break;
    }
    await sleep(500);
  }
  if (!leaseFree) {
    throw new Error('character lease did not expire after the crash');
  }
  const leaseWaitMs = Date.now() - leaseWaitStart;

  server = await startServer(port, databaseUrl);
  room = await joinRoom(port, await issueTicket(database, accountId, characterId));
  await waitUntil('rejoin', () => room.state.players.get(characterId));
  const rejoined = room.state.players.get(characterId)!;
  const rejoinPosition = { x: rejoined.x, y: rejoined.y };
  await room.leave();
  await stopServer(server, 'SIGTERM');

  const itemsAfter = await countItems(database, characterId);
  if (itemsBefore !== itemsAfter) {
    throw new Error(
      `item instances changed during the drill: ${String(itemsBefore)} -> ${String(itemsAfter)}`,
    );
  }
  if (rejoinPosition.x !== persisted.x || rejoinPosition.y !== persisted.y) {
    throw new Error(
      `rejoin position ${JSON.stringify(rejoinPosition)} does not match persisted ${JSON.stringify({ x: persisted.x, y: persisted.y })}`,
    );
  }

  return {
    scenario,
    characterId,
    joinPosition,
    movedPosition,
    rejoinPosition,
    persistedPosition: { x: persisted.x, y: persisted.y },
    itemInstances: { before: itemsBefore, after: itemsAfter },
    leaseWaitMs,
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required');
  }
  const database = createDatabase(databaseUrl, { max: 4 });
  try {
    const results: Evidence[] = [];
    results.push(await runScenario(database, databaseUrl, 'sigterm'));
    results.push(await runScenario(database, databaseUrl, 'sigkill'));

    const output = join(SERVER_DIR, '..', '..', 'docs', 'phase-reports', 'phase-08');
    await mkdir(output, { recursive: true });
    const file = join(output, 'recovery-drill.json');
    await writeFile(
      file,
      `${JSON.stringify({ runAt: new Date().toISOString(), results }, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    process.stdout.write(`recovery drill passed; evidence written to ${file}\n`);
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`recovery drill failed: ${String(error)}\n`);
  process.exitCode = 1;
});
