import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  MONSTER_STATE_CODES,
  PROTOCOL_VERSION,
  STARTER_WILDS_MAP_ID,
  commandRejectedSchema,
  partyInviteViewSchema,
  partySnapshotSchema,
  worldRoomNameFor,
  type CommandRejected,
  type PartyInviteView,
  type PartySnapshot,
} from '@web-legend/contracts';
import { WorldState, type WorldStateInstance } from '@web-legend/contracts/world-state';
import { createLogger } from '@web-legend/observability';
import {
  assetCommands,
  characters,
  createDatabase,
  worldDrops,
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
/** Slime next to the room's south-west pocket; no other spawn overlaps it. */
const SLIME = 'wilds_slime_2';
const SAFE_TILE = { x: 2, y: 16 };

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

async function waitForDatabase(
  read: () => Promise<boolean>,
  timeoutMs = 10_000,
  label = 'database condition',
): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (await read()) {
      return;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

function waitForParty(
  room: SdkRoom,
  predicate: (snapshot: PartySnapshot) => boolean,
  timeoutMs = 5_000,
): Promise<PartySnapshot> {
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for a matching party snapshot'));
    }, timeoutMs);
    unsubscribe = room.onMessage('party.snapshot', (payload: unknown) => {
      const parsed = partySnapshotSchema.parse(payload);
      if (!predicate(parsed)) {
        return;
      }
      clearTimeout(timer);
      unsubscribe();
      resolve(parsed);
    });
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

function joinOptions(ticket: string): Record<string, unknown> {
  return { protocolVersion: PROTOCOL_VERSION, ticket };
}

describe.runIf(databaseUrl !== undefined)('world_map parties', () => {
  let database: DatabaseHandle;
  let runtime: GameServerRuntime;
  let db: Database;
  let baseUrl: string;
  let sequence = 0;
  const cleanups: (() => Promise<void>)[] = [];
  const clients: Client[] = [];

  function nextSequence(): number {
    sequence += 1;
    return sequence;
  }

  function client(): Client {
    const instance = new Client(baseUrl);
    clients.push(instance);
    return instance;
  }

  async function createWorld(ticket: string): Promise<WorldRoom> {
    const room = (await client().create(
      worldRoomNameFor(STARTER_WILDS_MAP_ID),
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

  function actorAt(position: { x: number; y: number }, options: CreateActorOptions = {}) {
    return createActor(db, 'Party', {
      mapId: STARTER_WILDS_MAP_ID,
      position: tileUnits(position),
      level: 3,
      ...options,
    });
  }

  async function formParty(
    roomA: WorldRoom,
    roomB: WorldRoom,
    actorA: TestActor,
    actorB: TestActor,
  ): Promise<void> {
    const invitePromise = waitForMessage<PartyInviteView>(roomB, 'party.invite', (payload) =>
      partyInviteViewSchema.parse(payload),
    );
    roomA.send('party.invite', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      targetPlayerId: actorB.character.id,
    });
    const invite = await invitePromise;
    expect(invite.fromPlayerId).toBe(actorA.character.id);

    const joined = waitForParty(roomB, (snapshot) => snapshot.party !== null);
    roomB.send('party.accept', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      inviteId: invite.inviteId,
    });
    const snapshot = await joined;
    expect(snapshot.party?.members).toHaveLength(2);
    expect(snapshot.party?.leaderId).toBe(actorA.character.id);
  }

  async function killSlime(room: WorldRoom): Promise<void> {
    await waitUntil(
      () => room.state.monsters.get(SLIME) !== undefined,
      5_000,
      'slime visible to the killer',
    );
    room.send('combat.autoAttack.start', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      targetId: SLIME,
    });
    // Auto attack is a server loop; wait for the synced death state rather than
    // pacing swings from the test.
    await waitUntil(
      () => room.state.monsters.get(SLIME)?.state === MONSTER_STATE_CODES.dead,
      30_000,
      'slime death',
    );
  }

  async function characterExp(characterId: string): Promise<number> {
    const [row] = await db.select().from(characters).where(eq(characters.id, characterId));
    if (row === undefined) {
      throw new Error('character row missing');
    }
    return row.exp;
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
      GAME_SERVER_ID: 'game-server-party-test',
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
        monsterRespawnMs: 2_000,
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

  it('invites, accepts, leaves and disbands a party', async () => {
    const actorA = await actorAt(SAFE_TILE);
    const actorB = await actorAt({ x: 2, y: 17 });
    const roomA = await createWorld(actorA.ticket);
    await waitUntil(
      () => roomA.state.players.has(actorA.character.id),
      10_000,
      'first player joined',
    );
    const roomB = await joinWorld(roomA.roomId, actorB.ticket);
    await waitUntil(
      () => roomB.state.players.has(actorB.character.id),
      10_000,
      'second player joined',
    );
    await waitUntil(
      () => roomA.state.players.has(actorB.character.id),
      10_000,
      'first player sees the second',
    );

    const selfRejection = waitForMessage<CommandRejected>(roomA, 'command.rejected', (payload) =>
      commandRejectedSchema.parse(payload),
    );
    roomA.send('party.invite', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      targetPlayerId: actorA.character.id,
    });
    expect((await selfRejection).code).toBe('PARTY_SELF');

    await formParty(roomA, roomB, actorA, actorB);

    const leftA = waitForParty(
      roomA,
      (snapshot) =>
        snapshot.party?.members.map((member) => member.playerId).join() === actorA.character.id,
    );
    const leftB = waitForParty(roomB, (snapshot) => snapshot.party === null);
    roomB.send('party.leave', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
    });
    await Promise.all([leftA, leftB]);

    // The session's own departure also leaves the party: a dropped member must
    // not keep a roster slot after the reconnect grace expires.
    const invite = waitForMessage<PartyInviteView>(roomB, 'party.invite', (payload) =>
      partyInviteViewSchema.parse(payload),
    );
    roomA.send('party.invite', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      targetPlayerId: actorB.character.id,
    });
    const secondInvite = await invite;
    const joined = waitForParty(roomB, (snapshot) => snapshot.party !== null);
    roomB.send('party.accept', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      inviteId: secondInvite.inviteId,
    });
    await joined;

    // Closing the socket drops the member after the consented close, keeping
    // the leader's party of one.
    const afterLeave = waitForParty(
      roomA,
      (snapshot) =>
        snapshot.party?.members.map((member) => member.playerId).join() === actorA.character.id,
      10_000,
    );
    await roomB.leave();
    await afterLeave;
  });

  it('shares kill experience with nearby members only', async () => {
    const killer = await actorAt({ x: 6, y: 15 });
    const nearby = await actorAt({ x: 6, y: 16 });
    // 14 tiles from the killer (inside the 15-tile invite range) but 13 tiles
    // from the monster (outside the 12-tile assist range).
    const faraway = await actorAt({ x: 20, y: 15 });
    const roomKiller = await createWorld(killer.ticket);
    await waitUntil(
      () => roomKiller.state.players.has(killer.character.id),
      10_000,
      'killer joined',
    );
    const roomNearby = await joinWorld(roomKiller.roomId, nearby.ticket);
    await waitUntil(
      () => roomNearby.state.players.has(nearby.character.id),
      10_000,
      'nearby member joined',
    );
    const roomFaraway = await joinWorld(roomKiller.roomId, faraway.ticket);
    await waitUntil(
      () => roomFaraway.state.players.has(faraway.character.id),
      10_000,
      'far member joined',
    );

    await formParty(roomKiller, roomNearby, killer, nearby);
    // Add the far member through the same invite flow.
    const farInvite = waitForMessage<PartyInviteView>(roomFaraway, 'party.invite', (payload) =>
      partyInviteViewSchema.parse(payload),
    );
    roomKiller.send('party.invite', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      targetPlayerId: faraway.character.id,
    });
    const farInviteView = await farInvite;
    const farJoined = waitForParty(roomFaraway, (snapshot) => snapshot.party?.members.length === 3);
    roomFaraway.send('party.accept', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      inviteId: farInviteView.inviteId,
    });
    await farJoined;

    await killSlime(roomKiller);
    await waitForDatabase(
      async () => (await characterExp(nearby.character.id)) === 6,
      10_000,
      'nearby member assist experience',
    );

    // The killer keeps the full 12 experience; the nearby member gets half.
    await waitForDatabase(
      async () => (await characterExp(killer.character.id)) === 12,
      10_000,
      'killer reward',
    );
    expect(await characterExp(nearby.character.id)).toBe(6);
    // The faraway member was queued before the nearby one, so the nearby
    // commit proves the far member's share was skipped, not merely pending.
    expect(await characterExp(faraway.character.id)).toBe(0);

    // Assists never receive gold, drops or quest progress.
    expect(
      await db
        .select()
        .from(assetCommands)
        .where(
          and(
            eq(assetCommands.characterId, faraway.character.id),
            eq(assetCommands.kind, 'party_kill_reward'),
          ),
        ),
    ).toHaveLength(0);
    const farawayDrops = await db
      .select()
      .from(worldDrops)
      .where(eq(worldDrops.ownerCharacterId, faraway.character.id));
    expect(farawayDrops).toHaveLength(0);
    const killerDrops = await db
      .select()
      .from(worldDrops)
      .where(
        and(
          eq(worldDrops.mapId, STARTER_WILDS_MAP_ID),
          eq(worldDrops.ownerCharacterId, killer.character.id),
        ),
      );
    expect(killerDrops.length).toBeGreaterThan(0);
  });

  it('rejects an invite from outside the visible range', async () => {
    const actorA = await actorAt(SAFE_TILE);
    const actorB = await actorAt({ x: 38, y: 30 });
    const roomA = await createWorld(actorA.ticket);
    await waitUntil(
      () => roomA.state.players.has(actorA.character.id),
      10_000,
      'first player joined',
    );
    const roomB = await joinWorld(roomA.roomId, actorB.ticket);
    await waitUntil(
      () => roomB.state.players.has(actorB.character.id),
      10_000,
      'second player joined',
    );

    const rejection = waitForMessage<CommandRejected>(roomA, 'command.rejected', (payload) =>
      commandRejectedSchema.parse(payload),
    );
    roomA.send('party.invite', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      targetPlayerId: actorB.character.id,
    });
    expect((await rejection).code).toBe('PARTY_TARGET_UNAVAILABLE');
  });
});
