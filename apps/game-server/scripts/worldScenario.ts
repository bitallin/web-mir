/**
 * Phase-8 capacity scenario (ADR-023).
 *
 * Scenario A (default): LOAD_PLAYERS movers + LOAD_ATTACKERS attackers in the
 * wilds for LOAD_DURATION_MS, exercising movement, combat, AOI patches and
 * asset transactions against the real server and PostgreSQL.
 * Scenario B: 50 movers for a short burst.
 *
 * Metrics are read from the Agent's JSON and Prometheus endpoints; the script
 * fails when the room exceeds the tick targets or reports asset failures.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import { createOpaqueToken, hashToken } from '@web-legend/auth';
import {
  GAME_TICKET_TTL_SECONDS,
  PROTOCOL_VERSION,
  TILE_UNITS,
  commandRejectedSchema,
  worldRoomNameFor,
} from '@web-legend/contracts';
import { STARTER_WILDS_MAP } from '@web-legend/contracts/maps';
import { WorldState, type WorldStateInstance } from '@web-legend/contracts/world-state';
import { eq } from 'drizzle-orm';
import {
  createDatabase,
  insertAccount,
  insertCharacter,
  insertGameTicket,
  realms,
} from '@web-legend/persistence';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
// pnpm runs this script with cwd=apps/game-server; the shared file is at the
// repository root.
const ENV_FILE = join(SERVER_DIR, '..', '..', '.env');
if (existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
}

type Options = {
  players: number;
  attackers: number;
  durationMs: number;
  moveIntervalMs: number;
  attackIntervalMs: number;
  gameWebPort: number;
  gameServerPort: number;
  controlApiPort: number;
  databaseUrl: string;
  output: string;
  assertGoals: boolean;
  minAcceptRate: number;
};

type Tile = { x: number; y: number };

function readOptions(): Options {
  const players = Number(process.env['LOAD_PLAYERS'] ?? '30');
  const attackers = Number(process.env['LOAD_ATTACKERS'] ?? '10');
  const durationMs = Number(process.env['LOAD_DURATION_MS'] ?? '600000');
  if (!Number.isInteger(players) || players < 1 || players > 50) {
    throw new Error('LOAD_PLAYERS must be between 1 and 50');
  }
  if (!Number.isInteger(attackers) || attackers < 0 || attackers > players) {
    throw new Error('LOAD_ATTACKERS must be between 0 and LOAD_PLAYERS');
  }
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required');
  }
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const outputEnv = process.env['LOAD_OUTPUT'];
  const output =
    outputEnv === undefined
      ? join(SERVER_DIR, '..', '..', 'docs', 'phase-reports', 'phase-08', `load-${stamp}.json`)
      : isAbsolute(outputEnv)
        ? outputEnv
        : join(SERVER_DIR, '..', '..', outputEnv);
  return {
    players,
    attackers,
    durationMs,
    moveIntervalMs: Number(process.env['LOAD_MOVE_INTERVAL_MS'] ?? '500'),
    attackIntervalMs: Number(process.env['LOAD_ATTACK_INTERVAL_MS'] ?? '1000'),
    gameWebPort: Number(process.env['GAME_WEB_PORT'] ?? '84'),
    gameServerPort: Number(process.env['GAME_SERVER_PORT'] ?? '87'),
    controlApiPort: Number(process.env['CONTROL_API_PORT'] ?? '86'),
    databaseUrl,
    output,
    assertGoals: process.env['LOAD_ASSERT'] !== 'false',
    minAcceptRate: Number(process.env['LOAD_MIN_ACCEPT_RATE'] ?? '0.7'),
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
          reject(new Error(`${url} returned ${String(response.statusCode)}`));
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

function readText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`${url} returned ${String(response.statusCode)}`));
          return;
        }
        resolve(body);
      });
    }).on('error', reject);
  });
}

type RoomMetricsJson = {
  roomId: string;
  mapId: string;
  instanceId: string;
  players: number;
  wsSentBytes: number;
  wsPatchBytes: number;
  wsReceivedBytes: number;
  wsConnections: number;
  wsDisconnects: number;
  wsReconnects: number;
  acceptedCommands: number;
  rejectedCommands: number;
  combatCommands: number;
  combatEvents: number;
  monsterKills: number;
  playerDeaths: number;
  assetCommands: number;
  assetFailures: number;
  lootSpawned: number;
  lootPickedUp: number;
  goldGranted: number;
  expGranted: number;
  tick: { samples: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number };
  assetTx: { samples: number; p50Ms: number; p95Ms: number; p99Ms: number };
};

type MetricsJson = {
  rooms: RoomMetricsJson[];
  totals: { activeRooms: number; acceptedCommands: number; rejectedCommands: number };
};

function parseMetric(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  if (match === null) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function walkableTiles(manifest: typeof STARTER_WILDS_MAP): Tile[] {
  const portalKeys = new Set(
    manifest.portals.map((portal) => `${String(portal.tile.x)}:${String(portal.tile.y)}`),
  );
  const start = manifest.spawnPoints[0];
  if (start === undefined) {
    throw new Error('wilds has no spawn point');
  }
  const reachable = new Set<string>([`${String(start.x)}:${String(start.y)}`]);
  const queue: Tile[] = [start];
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
        next.x >= manifest.width ||
        next.y >= manifest.height ||
        manifest.layers.collision[next.y * manifest.width + next.x] !== 0
      ) {
        continue;
      }
      reachable.add(key);
      queue.push(next);
    }
  }
  return [...reachable]
    .filter((key) => !portalKeys.has(key))
    .map((key) => {
      const [x, y] = key.split(':');
      return { x: Number(x), y: Number(y) };
    });
}

function pickTile(tiles: readonly Tile[], random: () => number): Tile {
  const tile = tiles[Math.floor(random() * tiles.length)];
  if (tile === undefined) {
    throw new Error('no walkable tile available');
  }
  return tile;
}

function units(tile: Tile): { x: number; y: number } {
  return {
    x: tile.x * TILE_UNITS + TILE_UNITS / 2,
    y: tile.y * TILE_UNITS + TILE_UNITS / 2,
  };
}

function randomSuffix(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 6);
}

type LoadClient = {
  room: SdkRoom<unknown, WorldStateInstance>;
  characterId: string;
  attacker: boolean;
  sequence: number;
};

async function provisionCharacters(
  options: Options,
  tiles: readonly Tile[],
): Promise<
  {
    accountId: string;
    characterId: string;
    ticket: string;
    attacker: boolean;
  }[]
> {
  const database = createDatabase(options.databaseUrl, { max: 4 });
  try {
    await database.db
      .insert(realms)
      .values({ code: 'classic-01', name: '经典一区', status: 'active' })
      .onConflictDoNothing({ target: realms.code });
    const [realm] = await database.db
      .select({ id: realms.id })
      .from(realms)
      .where(eqRealm('classic-01'))
      .limit(1);
    if (realm === undefined) {
      throw new Error('classic-01 realm is missing');
    }
    const attackSpawns = STARTER_WILDS_MAP.monsterSpawns;
    const created: {
      accountId: string;
      characterId: string;
      ticket: string;
      attacker: boolean;
    }[] = [];
    for (let index = 0; index < options.players; index += 1) {
      const attacker = index < options.attackers;
      const spawn = attacker
        ? (attackSpawns[index % attackSpawns.length]?.tile ?? pickTile(tiles, Math.random))
        : pickTile(tiles, Math.random);
      const position = units(spawn);
      const suffix = `${randomSuffix()}${String(index)}`;
      const account = await insertAccount(database.db, {
        username: `load8_${suffix}`.slice(0, 24),
        usernameNormalized: `load8_${suffix}`.slice(0, 24),
        passwordHash: 'load-scenario-only-hash',
      });
      const character = await insertCharacter(database.db, {
        accountId: account.id,
        realmId: realm.id,
        name: `L8${suffix}`.slice(0, 12),
        nameNormalized: `l8${suffix}`.slice(0, 12),
        classId: 'warrior',
        level: 10,
        exp: 0,
        hp: 300,
        maxHp: 300,
        mp: 60,
        maxMp: 60,
        mapId: STARTER_WILDS_MAP.mapId,
        x: position.x,
        y: position.y,
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
      created.push({
        accountId: account.id,
        characterId: character.id,
        ticket,
        attacker,
      });
    }
    return created;
  } finally {
    await database.close();
  }
}

function eqRealm(code: string) {
  return eq(realms.code, code);
}

function nearestMonster(
  room: SdkRoom<unknown, WorldStateInstance>,
  characterId: string,
): { id: string; x: number; y: number } | null {
  const player = room.state.players.get(characterId);
  if (player === undefined) {
    return null;
  }
  const candidates: { id: string; x: number; y: number; distance: number }[] = [];
  room.state.monsters.forEach((monster, id) => {
    if (monster.hp <= 0) {
      return;
    }
    candidates.push({
      id,
      x: monster.x,
      y: monster.y,
      distance: Math.hypot(monster.x - player.x, monster.y - player.y),
    });
  });
  candidates.sort((left, right) => left.distance - right.distance);
  const best = candidates[0];
  return best === undefined ? null : { id: best.id, x: best.x, y: best.y };
}

async function main(): Promise<void> {
  const options = readOptions();
  const tiles = walkableTiles(STARTER_WILDS_MAP);
  const metricsUrl = `http://127.0.0.1:${String(options.gameServerPort)}/metrics`;
  const prometheusUrl = `http://127.0.0.1:${String(options.gameServerPort)}/metrics/prometheus`;
  const controlMetricsUrl = `http://127.0.0.1:${String(options.controlApiPort)}/metrics/prometheus`;
  const clientUrl =
    process.env['LOAD_CLIENT_URL'] ?? `ws://127.0.0.1:${String(options.gameWebPort)}/ws`;
  const roomName = worldRoomNameFor(STARTER_WILDS_MAP.mapId);

  const preflight = (await readJson(metricsUrl)) as MetricsJson;
  const existing = preflight.rooms.find((room) => room.mapId === STARTER_WILDS_MAP.mapId);
  if ((existing?.players ?? 0) + options.players > 50) {
    throw new Error(
      `room already has ${String(existing?.players ?? 0)} players; cannot add ${String(options.players)} (max 50)`,
    );
  }

  process.stdout.write(
    `scenario: players=${String(options.players)} attackers=${String(options.attackers)} ` +
      `duration=${String(options.durationMs / 1000)}s room=${roomName}\n`,
  );

  const actors = await provisionCharacters(options, tiles);
  const clients: LoadClient[] = [];
  let clientAccepted = 0;
  let clientRejected = 0;
  const rejectedByCode: Record<string, number> = {};

  for (const actor of actors) {
    const client = new Client(clientUrl);
    const room = (await client.joinOrCreate(
      roomName,
      { protocolVersion: PROTOCOL_VERSION, ticket: actor.ticket },
      WorldState,
    )) as SdkRoom<unknown, WorldStateInstance>;
    room.onMessage('command.ack', () => {
      clientAccepted += 1;
    });
    room.onMessage('command.rejected', (payload: unknown) => {
      clientRejected += 1;
      const parsed = commandRejectedSchema.safeParse(payload);
      const code = parsed.success ? parsed.data.code : 'UNKNOWN';
      rejectedByCode[code] = (rejectedByCode[code] ?? 0) + 1;
    });
    for (const type of [
      'combat.profile',
      'inventory.snapshot',
      'system.notice',
      'shop.catalog',
      'combat.event',
      'loot.claimed',
      'inventory.snapshot',
      'character.progress',
      'character.levelUp',
      'asset.result',
      'quest.snapshot',
      'quest.update',
      'party.snapshot',
      'party.invite',
      'friend.snapshot',
      'friend.presence',
      'friend.refresh',
    ]) {
      room.onMessage(type, () => undefined);
    }
    clients.push({ room, characterId: actor.characterId, attacker: actor.attacker, sequence: 0 });
  }

  const tickSamples: { at: string; room: RoomMetricsJson }[] = [];
  const runtimeSamples: {
    at: string;
    eventLoopP99Ms: number | null;
    rssBytes: number | null;
    cpuUserSeconds: number | null;
    dbProbeSeconds: number | null;
  }[] = [];

  const startedAt = Date.now();
  let nextSampleAt = startedAt + 15_000;

  while (Date.now() - startedAt < options.durationMs) {
    const loopStart = Date.now();
    for (const client of clients) {
      const target = pickTile(tiles, Math.random);
      client.sequence += 1;
      client.room.send('move.to', {
        protocolVersion: PROTOCOL_VERSION,
        commandId: randomUUID(),
        clientSequence: client.sequence,
        targetTileX: target.x,
        targetTileY: target.y,
      });
    }
    for (const client of clients) {
      if (!client.attacker) {
        continue;
      }
      const monster = nearestMonster(client.room, client.characterId);
      client.sequence += 1;
      if (monster === null) {
        const spawn =
          STARTER_WILDS_MAP.monsterSpawns[
            Math.floor(Math.random() * STARTER_WILDS_MAP.monsterSpawns.length)
          ];
        const target = spawn?.tile ?? pickTile(tiles, Math.random);
        client.room.send('move.to', {
          protocolVersion: PROTOCOL_VERSION,
          commandId: randomUUID(),
          clientSequence: client.sequence,
          targetTileX: target.x,
          targetTileY: target.y,
        });
      } else {
        // Approach before swinging: attacking from across the map only
        // produces OUT_OF_RANGE rejections and makes the acceptance metric
        // meaningless (TD-QA-02).
        const player = client.room.state.players.get(client.characterId);
        const distance =
          player === undefined
            ? Number.POSITIVE_INFINITY
            : Math.hypot(monster.x - player.x, monster.y - player.y);
        if (distance > 1.2 * TILE_UNITS) {
          client.room.send('move.to', {
            protocolVersion: PROTOCOL_VERSION,
            commandId: randomUUID(),
            clientSequence: client.sequence,
            targetTileX: Math.floor(monster.x / TILE_UNITS),
            targetTileY: Math.floor(monster.y / TILE_UNITS),
          });
        } else {
          client.room.send('combat.basicAttack', {
            protocolVersion: PROTOCOL_VERSION,
            commandId: randomUUID(),
            clientSequence: client.sequence,
            targetId: monster.id,
          });
        }
      }
    }

    if (Date.now() >= nextSampleAt) {
      const json = (await readJson(metricsUrl)) as MetricsJson;
      const room = json.rooms.find((entry) => entry.mapId === STARTER_WILDS_MAP.mapId);
      if (room !== undefined) {
        tickSamples.push({ at: new Date().toISOString(), room });
      }
      try {
        const text = await readText(prometheusUrl);
        const control = await readText(controlMetricsUrl);
        const lag = parseMetric(
          text,
          /^nodejs_event_loop_lag_seconds\{quantile="0.99"\} ([\d.]+)$/mu,
        );
        runtimeSamples.push({
          at: new Date().toISOString(),
          eventLoopP99Ms: lag === null ? null : lag * 1000,
          rssBytes: parseMetric(text, /^process_resident_memory_bytes ([\d.]+)$/mu),
          cpuUserSeconds: parseMetric(
            text,
            /^process_cpu_seconds_total\{kind="user"\} ([\d.]+)$/mu,
          ),
          dbProbeSeconds: parseMetric(control, /^web_legend_db_probe_duration_seconds ([\d.]+)$/mu),
        });
      } catch {
        runtimeSamples.push({
          at: new Date().toISOString(),
          eventLoopP99Ms: null,
          rssBytes: null,
          cpuUserSeconds: null,
          dbProbeSeconds: null,
        });
      }
      nextSampleAt += 15_000;
    }

    const elapsed = Date.now() - loopStart;
    if (elapsed < options.moveIntervalMs) {
      await wait(options.moveIntervalMs - elapsed);
    }
  }

  await wait(1_000);
  const finalMetrics = (await readJson(metricsUrl)) as MetricsJson;
  const wilds = finalMetrics.rooms.find((room) => room.mapId === STARTER_WILDS_MAP.mapId);
  if (wilds === undefined) {
    throw new Error('wilds room metrics were not reported');
  }

  const reconnectRate = wilds.wsConnections > 0 ? wilds.wsReconnects / wilds.wsConnections : 0;
  const acceptRate =
    clientAccepted + clientRejected === 0 ? 1 : clientAccepted / (clientAccepted + clientRejected);
  const summary = {
    runAt: new Date().toISOString(),
    // Evidence is committed; never persist the connection string.
    options: { ...options, databaseUrl: '[redacted]' },
    joined: clients.length,
    clientAccepted,
    clientRejected,
    acceptRate,
    rejectedByCode,
    reconnectRate,
    inboundBytesPerPlayer: wilds.players > 0 ? wilds.wsReceivedBytes / wilds.players : 0,
    room: wilds,
    samples: tickSamples,
    runtime: runtimeSamples,
    runtimeMax: {
      eventLoopP99Ms:
        runtimeSamples.reduce((max, sample) => Math.max(max, sample.eventLoopP99Ms ?? 0), 0) ||
        null,
      rssBytes:
        runtimeSamples.reduce((max, sample) => Math.max(max, sample.rssBytes ?? 0), 0) || null,
      dbProbeSeconds:
        runtimeSamples.reduce((max, sample) => Math.max(max, sample.dbProbeSeconds ?? 0), 0) ||
        null,
    },
  };

  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(
    `joined=${String(clients.length)}/${String(options.players)} ` +
      `accepted=${String(clientAccepted)} rejected=${String(clientRejected)} ` +
      `acceptRate=${(acceptRate * 100).toFixed(1)}% codes=${JSON.stringify(rejectedByCode)} ` +
      `players=${String(wilds.players)} tick p50=${String(wilds.tick.p50Ms)}ms ` +
      `p95=${String(wilds.tick.p95Ms)}ms p99=${String(wilds.tick.p99Ms)}ms ` +
      `max=${String(wilds.tick.maxMs)}ms assetTx p95=${String(wilds.assetTx.p95Ms)}ms ` +
      `wsOut=${String(wilds.wsSentBytes)}B wsIn=${String(wilds.wsReceivedBytes)}B ` +
      `patch=${String(wilds.wsPatchBytes)}B reconnectRate=${(reconnectRate * 100).toFixed(2)}% ` +
      `kills=${String(wilds.monsterKills)} assetFailures=${String(wilds.assetFailures)}\n`,
  );
  process.stdout.write(`evidence: ${options.output}\n`);

  if (options.assertGoals) {
    if (clients.length < options.players) {
      throw new Error('not every virtual player joined');
    }
    if (wilds.players < options.players) {
      throw new Error('room did not report all virtual players');
    }
    if (clientAccepted === 0) {
      throw new Error('no command was acknowledged');
    }
    if (acceptRate < options.minAcceptRate) {
      throw new Error(
        `command acceptance ${(acceptRate * 100).toFixed(1)}% is below ` +
          `${(options.minAcceptRate * 100).toFixed(0)}%; codes=${JSON.stringify(rejectedByCode)}`,
      );
    }
    if (wilds.tick.p95Ms >= 25 || wilds.tick.p99Ms >= 40) {
      throw new Error(
        `tick target missed: p95=${String(wilds.tick.p95Ms)}ms p99=${String(wilds.tick.p99Ms)}ms`,
      );
    }
    if (wilds.assetFailures > 0) {
      throw new Error(`asset failures: ${String(wilds.assetFailures)}`);
    }
    if (wilds.wsPatchBytes === 0) {
      throw new Error('no patch bytes were recorded');
    }
    if (wilds.wsReceivedBytes === 0) {
      throw new Error('no inbound WebSocket bytes were recorded');
    }
    if (options.attackers > 0 && wilds.combatEvents === 0) {
      throw new Error('attackers produced no combat events');
    }
  }

  // A mover can step onto the wilds portal and be transferred to town; the
  // SDK's leave promise then never settles because the server already closed
  // that room. Bound the teardown, then close anything still open so the
  // scenario exits after writing its report instead of hanging forever.
  await Promise.race([
    Promise.allSettled(clients.map(async (client) => client.room.leave())),
    wait(5_000),
  ]);
  for (const client of clients) {
    if (client.room.connection.isOpen) {
      client.room.connection.close();
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`world scenario failed: ${String(error)}\n`);
  process.exitCode = 1;
});
