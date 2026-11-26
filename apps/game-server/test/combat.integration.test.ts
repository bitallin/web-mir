import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  MONSTER_STATE_CODES,
  PROTOCOL_VERSION,
  STARTER_WILDS_MAP_ID,
  combatEventSchema,
  combatProfileSchema,
  combatTargetChangedSchema,
  commandRejectedSchema,
  chatMessageSchema,
  worldRoomNameFor,
  type CombatEvent,
  type CombatProfile,
  type CombatTargetChanged,
  type CommandRejected,
} from '@web-legend/contracts';
import { WorldState, type WorldStateInstance } from '@web-legend/contracts/world-state';
import { createLogger } from '@web-legend/observability';
import { createDatabase, type Database, type DatabaseHandle } from '@web-legend/persistence';
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
const SLIME = 'wilds_slime_2';
const SLIME_TILE = { x: 7, y: 15 };
const SECOND_SLIME = 'wilds_slime_3';

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

function collectCombatEvents(room: WorldRoom): CombatEvent[] {
  const events: CombatEvent[] = [];
  room.onMessage('combat.event', (payload: unknown) => {
    events.push(combatEventSchema.parse(payload));
  });
  return events;
}

function monsterState(room: WorldRoom, id: string) {
  return room.state.monsters.get(id);
}

describe.runIf(databaseUrl !== undefined)('world_map combat', () => {
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

  function wildsActor(options: CreateActorOptions = {}): Promise<TestActor> {
    return createActor(db, 'Combat', {
      mapId: STARTER_WILDS_MAP_ID,
      position: tileUnits({ x: 6, y: 15 }),
      ...options,
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
      GAME_SERVER_ID: 'game-server-combat-test',
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

  it('exposes nearby monsters with a class combat profile', async () => {
    const actor = await wildsActor();
    const room = await createWorld(actor.ticket);
    const events = collectCombatEvents(room);

    const profile = await waitForMessage<CombatProfile>(room, 'combat.profile', (payload) =>
      combatProfileSchema.parse(payload),
    );
    expect(profile.classId).toBe('warrior');
    expect(profile.attack).toBe(12);
    expect(profile.skills.map((skill) => skill.id)).toEqual(['warrior_heavy_strike']);
    expect(profile.skills[0]?.cooldownRemainingMs).toBe(0);

    await waitUntil(() => monsterState(room, SLIME) !== undefined, 5_000, 'slime visible');
    const slime = monsterState(room, SLIME);
    expect(slime?.templateId).toBe('wild_slime');
    expect(slime?.hp).toBe(50);
    // The adjacent player aggros immediately, so any living FSM state is valid.
    expect(slime?.state).not.toBe(MONSTER_STATE_CODES.dead);

    room.send('combat.basicAttack', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetId: SLIME,
    });

    await waitUntil(
      () => events.some((event) => event.kind === 'hit' && event.targetId === SLIME),
      3_000,
      'first hit',
    );
    const hit = events.find((event) => event.kind === 'hit' && event.targetId === SLIME);
    expect(hit?.kind).toBe('hit');
    if (hit?.kind !== 'hit') {
      return;
    }
    expect(hit.sourceType).toBe('player');
    // Seeded zero variance: 12 attack - 2 defense / 2 = 11.
    expect(hit.damage).toBe(11);
    expect(hit.critical).toBe(false);
    await waitUntil(() => monsterState(room, SLIME)?.hp === hit.targetHp, 2_000, 'hp sync');

    const rejection = waitForMessage<CommandRejected>(room, 'command.rejected', (payload) =>
      commandRejectedSchema.parse(payload),
    );
    room.send('combat.basicAttack', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 1,
      targetId: SLIME,
    });
    const cooldown = await rejection;
    expect(cooldown.code).toBe('COOLDOWN');
    expect(cooldown.retryAfterMs).toBeGreaterThan(0);
  });

  it('spends mana for skills and rejects forged or wrong-protocol commands', async () => {
    const actor = await wildsActor();
    const room = await createWorld(actor.ticket);
    const events = collectCombatEvents(room);
    await waitForMessage(room, 'combat.profile', (payload) => combatProfileSchema.parse(payload));
    await waitUntil(() => monsterState(room, SLIME) !== undefined, 5_000, 'slime visible');

    const startHp = monsterState(room, SLIME)?.hp ?? 0;
    room.send('skill.cast', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      skillId: 'warrior_heavy_strike',
      targetId: SLIME,
    });
    await waitUntil(
      () =>
        events.some((event) => event.kind === 'attack' && event.skillId === 'warrior_heavy_strike'),
      3_000,
      'heavy strike',
    );
    // Mana regenerates, so 24 is only a brief value; assert the spend itself.
    await waitUntil(
      () => (room.state.players.get(actor.character.id)?.mp ?? 30) < 30,
      2_000,
      'mp spend',
    );
    await waitUntil(
      () => (monsterState(room, SLIME)?.hp ?? startHp) < startHp,
      2_000,
      'skill damage',
    );

    const forgedRejection = waitForMessage<CommandRejected>(room, 'command.rejected', (payload) =>
      commandRejectedSchema.parse(payload),
    );
    room.send('combat.basicAttack', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 1,
      targetId: SLIME,
      damage: 999,
    });
    expect((await forgedRejection).code).toBe('INVALID_PAYLOAD');

    const protocolRejection = waitForMessage<CommandRejected>(room, 'command.rejected', (payload) =>
      commandRejectedSchema.parse(payload),
    );
    room.send('combat.basicAttack', {
      protocolVersion: 999,
      commandId: randomUUID(),
      clientSequence: 2,
      targetId: SLIME,
    });
    expect((await protocolRejection).code).toBe('PROTOCOL_MISMATCH');

    const hpBeforeCooldownProbe = monsterState(room, SLIME)?.hp;
    const cooldownRejection = waitForMessage<CommandRejected>(room, 'command.rejected', (payload) =>
      commandRejectedSchema.parse(payload),
    );
    room.send('skill.cast', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 3,
      skillId: 'warrior_heavy_strike',
      targetId: SLIME,
    });
    const cooldown = await cooldownRejection;
    expect(cooldown.code).toBe('COOLDOWN');
    expect(monsterState(room, SLIME)?.hp).toBe(hpBeforeCooldownProbe);
  });

  it('replays a duplicate command id without rolling a second hit', async () => {
    const actor = await wildsActor();
    const room = await createWorld(actor.ticket);
    const events = collectCombatEvents(room);
    await waitUntil(() => monsterState(room, SLIME) !== undefined, 5_000, 'slime visible');

    const command = {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetId: SLIME,
    };
    room.send('combat.basicAttack', command);
    room.send('combat.basicAttack', command);

    await waitUntil(
      () => events.filter((event) => event.kind === 'hit' && event.targetId === SLIME).length >= 2,
      3_000,
      'duplicate delivery',
    );
    const hits = events.filter(
      (event): event is Extract<CombatEvent, { kind: 'hit' }> =>
        event.kind === 'hit' && event.targetId === SLIME,
    );
    expect(hits).toHaveLength(2);
    expect(hits[0]?.eventId).toBe(hits[1]?.eventId);
    expect(hits[0]?.targetHp).toBe(hits[1]?.targetHp);
    await waitUntil(
      () => monsterState(room, SLIME)?.hp === hits[0]?.targetHp,
      2_000,
      'deduplicated hp sync',
    );
  });

  it('keeps one authoritative monster hp for two attackers', async () => {
    const alice = await wildsActor();
    const bob = await createActor(db, 'CombatBob', {
      mapId: STARTER_WILDS_MAP_ID,
      position: tileUnits({ x: 8, y: 15 }),
    });
    const aliceRoom = await createWorld(alice.ticket);
    const bobRoom = await joinWorld(aliceRoom.roomId, bob.ticket);
    const aliceEvents = collectCombatEvents(aliceRoom);
    const bobEvents = collectCombatEvents(bobRoom);

    await waitUntil(
      () => aliceRoom.state.players.size === 2 && monsterState(aliceRoom, SLIME) !== undefined,
      5_000,
      'both players and slime visible',
    );
    expect(monsterState(bobRoom, SLIME)).toBeDefined();

    aliceRoom.send('combat.basicAttack', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetId: SLIME,
    });
    await waitUntil(
      () => aliceEvents.some((event) => event.kind === 'hit' && event.targetId === SLIME),
      3_000,
      'alice hit',
    );
    bobRoom.send('combat.basicAttack', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetId: SLIME,
    });
    await waitUntil(
      () => bobEvents.some((event) => event.kind === 'hit' && event.targetId === SLIME),
      3_000,
      'bob hit',
    );

    const lastAliceHit = aliceEvents
      .filter(
        (event): event is Extract<CombatEvent, { kind: 'hit' }> =>
          event.kind === 'hit' && event.targetId === SLIME,
      )
      .at(-1);
    await waitUntil(
      () =>
        monsterState(aliceRoom, SLIME)?.hp === lastAliceHit?.targetHp &&
        monsterState(bobRoom, SLIME)?.hp === lastAliceHit?.targetHp,
      3_000,
      'shared authoritative hp',
    );
    expect(monsterState(aliceRoom, SLIME)?.hp).toBeLessThan(50);
  });

  it('lets a monster chase and damage a player', async () => {
    const actor = await wildsActor({ position: tileUnits({ x: 8, y: 15 }) });
    const room = await createWorld(actor.ticket);
    const events = collectCombatEvents(room);
    await waitUntil(() => monsterState(room, SLIME) !== undefined, 5_000, 'slime visible');

    await waitUntil(
      () => events.some((event) => event.kind === 'hit' && event.targetType === 'player'),
      6_000,
      'monster hit',
    );
    const hit = events.find(
      (event): event is Extract<CombatEvent, { kind: 'hit' }> =>
        event.kind === 'hit' && event.targetType === 'player',
    );
    expect(hit?.sourceType).toBe('monster');
    await waitUntil(
      () => room.state.players.get(actor.character.id)?.hp === hit?.targetHp,
      2_000,
      'player hp sync',
    );
    expect(room.state.players.get(actor.character.id)?.hp).toBeLessThan(120);
  });

  it('kills a monster and respawns it at the same spawn point', async () => {
    const actor = await wildsActor();
    const room = await createWorld(actor.ticket);
    const events = collectCombatEvents(room);
    await waitUntil(() => monsterState(room, SLIME) !== undefined, 5_000, 'slime visible');

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (events.some((event) => event.kind === 'death' && event.entityId === SLIME)) {
        break;
      }
      const hitsBefore = events.filter(
        (event) => event.kind === 'hit' && event.targetId === SLIME,
      ).length;
      room.send('combat.basicAttack', {
        protocolVersion: PROTOCOL_VERSION,
        commandId: randomUUID(),
        clientSequence: attempt,
        targetId: SLIME,
      });
      await waitUntil(
        () =>
          events.some((event) => event.kind === 'death' && event.entityId === SLIME) ||
          events.filter((event) => event.kind === 'hit' && event.targetId === SLIME).length >
            hitsBefore,
        2_000,
        `attack ${String(attempt)} resolved`,
      );
      if (events.some((event) => event.kind === 'death' && event.entityId === SLIME)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 950));
    }

    await waitUntil(
      () => monsterState(room, SLIME)?.state === MONSTER_STATE_CODES.dead,
      5_000,
      'monster death',
    );
    expect(monsterState(room, SLIME)?.hp).toBe(0);
    expect(events.some((event) => event.kind === 'death' && event.entityId === SLIME)).toBe(true);

    await waitUntil(
      () => events.some((event) => event.kind === 'spawn' && event.entityId === SLIME),
      5_000,
      'monster respawn',
    );
    await waitUntil(() => monsterState(room, SLIME)?.hp === 50, 3_000, 'respawn hp');
    // Players are still adjacent, so the respawned monster may already aggro.
    expect(monsterState(room, SLIME)?.state).not.toBe(MONSTER_STATE_CODES.dead);
    const spawnEvent = events.find((event) => event.kind === 'spawn' && event.entityId === SLIME);
    expect(spawnEvent?.kind).toBe('spawn');
    if (spawnEvent?.kind !== 'spawn') {
      return;
    }
    expect(Math.floor(spawnEvent.x / 1_000)).toBe(SLIME_TILE.x);
    expect(Math.floor(spawnEvent.y / 1_000)).toBe(SLIME_TILE.y);
  });

  it('respawns a defeated player at the map spawn point', async () => {
    const actor = await wildsActor({ position: tileUnits({ x: 8, y: 15 }), hp: 5 });
    const room = await createWorld(actor.ticket);
    const events = collectCombatEvents(room);
    await waitUntil(() => monsterState(room, SLIME) !== undefined, 5_000, 'slime visible');

    await waitUntil(
      () => events.some((event) => event.kind === 'death' && event.entityId === actor.character.id),
      10_000,
      'player death',
    );
    await waitUntil(
      () => room.state.players.get(actor.character.id)?.alive === false,
      2_000,
      'dead state sync',
    );

    await waitUntil(
      () =>
        events.some((event) => event.kind === 'respawn' && event.entityId === actor.character.id),
      5_000,
      'player respawn',
    );
    await waitUntil(
      () => room.state.players.get(actor.character.id)?.alive === true,
      3_000,
      'alive',
    );
    const revived = room.state.players.get(actor.character.id);
    expect(revived?.hp).toBe(120);
    expect(Math.floor((revived?.x ?? 0) / 1_000)).toBe(2);
    expect(Math.floor((revived?.y ?? 0) / 1_000)).toBe(16);
  });

  it('approaches and kills a locked target with one engage command (TD-CLI-01)', async () => {
    // Two tiles away from the slime, so the server has to walk before it can
    // swing. No per-swing client message is sent after the initial engage.
    const actor = await wildsActor({ position: tileUnits({ x: 2, y: 15 }) });
    const room = await createWorld(actor.ticket);
    const events = collectCombatEvents(room);
    const changes: CombatTargetChanged[] = [];
    room.onMessage('combat.target.changed', (payload: unknown) => {
      changes.push(combatTargetChangedSchema.parse(payload));
    });
    const rejections: CommandRejected[] = [];
    room.onMessage('command.rejected', (payload: unknown) => {
      rejections.push(commandRejectedSchema.parse(payload));
    });

    await waitForMessage(room, 'combat.profile', (payload) => combatProfileSchema.parse(payload));
    await waitUntil(() => monsterState(room, SLIME) !== undefined, 5_000, 'slime visible');
    const startX = room.state.players.get(actor.character.id)?.x ?? 0;

    room.send('combat.engage', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetId: SLIME,
    });

    await waitUntil(
      () =>
        changes.some((change) => change.reason === 'approaching' || change.reason === 'attacking'),
      5_000,
      'auto-attack state',
    );
    await waitUntil(
      () => (room.state.players.get(actor.character.id)?.x ?? startX) > startX,
      5_000,
      'approach movement',
    );
    await waitUntil(
      () =>
        events.filter((event) => event.kind === 'hit' && event.sourceId === actor.character.id)
          .length >= 2,
      15_000,
      'two server-driven hits',
    );
    await waitUntil(
      () => monsterState(room, SLIME)?.state === MONSTER_STATE_CODES.dead,
      15_000,
      'slime defeated by auto attack',
    );
    await waitUntil(
      () => changes.some((change) => change.reason === 'target_dead' && !change.autoAttack),
      3_000,
      'auto attack stops on target death',
    );

    // Auto swings are server-generated: the client never learns a COOLDOWN
    // rejection from them and never has to repeat an attack command.
    expect(rejections.filter((rejection) => rejection.code === 'COOLDOWN')).toHaveLength(0);
  });

  it('runs independent auto-attack loops for two players at once', async () => {
    const first = await wildsActor({ position: tileUnits({ x: 6, y: 15 }) });
    const second = await createActor(db, 'AutoTwo', {
      mapId: STARTER_WILDS_MAP_ID,
      position: tileUnits({ x: 10, y: 20 }),
    });
    const firstRoom = await createWorld(first.ticket);
    await waitForMessage(firstRoom, 'combat.profile', (payload) =>
      combatProfileSchema.parse(payload),
    );
    await waitUntil(
      () => monsterState(firstRoom, SLIME) !== undefined,
      5_000,
      'first slime visible',
    );

    const secondRoom = await joinWorld(firstRoom.roomId, second.ticket);
    await waitUntil(
      () => monsterState(secondRoom, SECOND_SLIME) !== undefined,
      5_000,
      'second slime visible',
    );
    const firstEvents = collectCombatEvents(firstRoom);
    const secondEvents = collectCombatEvents(secondRoom);

    firstRoom.send('combat.engage', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetId: SLIME,
    });
    secondRoom.send('combat.engage', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetId: SECOND_SLIME,
    });

    await waitUntil(
      () => monsterState(firstRoom, SLIME)?.state === MONSTER_STATE_CODES.dead,
      20_000,
      'first auto attack kill',
    );
    await waitUntil(
      () => monsterState(secondRoom, SECOND_SLIME)?.state === MONSTER_STATE_CODES.dead,
      20_000,
      'second auto attack kill',
    );

    // Both players are inside each other's AOI, so each may see the other's
    // fight; what must hold is that each auto-attack loop only damages its own
    // locked target.
    expect(
      firstEvents
        .filter((event) => event.kind === 'hit' && event.sourceId === first.character.id)
        .every((event) => event.kind === 'hit' && event.targetId === SLIME),
    ).toBe(true);
    expect(
      secondEvents
        .filter((event) => event.kind === 'hit' && event.sourceId === second.character.id)
        .every((event) => event.kind === 'hit' && event.targetId === SECOND_SLIME),
    ).toBe(true);
  });

  it('does not leak combat events to players outside the AOI (TD-SRV-02)', async () => {
    const near = await wildsActor({ position: tileUnits({ x: 6, y: 15 }) });
    const far = await wildsActor({ position: tileUnits({ x: 40, y: 2 }) });
    const nearRoom = await createWorld(near.ticket);
    await waitForMessage(nearRoom, 'combat.profile', (payload) =>
      combatProfileSchema.parse(payload),
    );
    await waitUntil(() => monsterState(nearRoom, SLIME) !== undefined, 5_000, 'slime visible');

    const farRoom = await joinWorld(nearRoom.roomId, far.ticket);
    await waitUntil(
      () => farRoom.state.players.get(far.character.id) !== undefined,
      5_000,
      'far player joined',
    );
    const farEvents = collectCombatEvents(farRoom);

    nearRoom.send('combat.engage', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      targetId: SLIME,
    });

    const nearEvents = collectCombatEvents(nearRoom);
    await waitUntil(
      () =>
        nearEvents.filter((event) => event.kind === 'hit' && event.sourceId === near.character.id)
          .length >= 2,
      10_000,
      'near player lands two hits',
    );

    const leaked = farEvents.filter(
      (event) =>
        ('sourceId' in event && event.sourceId === near.character.id) ||
        ('targetId' in event && event.targetId === SLIME) ||
        ('entityId' in event && event.entityId === SLIME),
    );
    expect(leaked).toEqual([]);
  });

  it('delivers heal events only to the caster and healed player (TD-SRV-02)', async () => {
    const healer = await createActor(db, 'Healer', {
      mapId: STARTER_WILDS_MAP_ID,
      position: tileUnits({ x: 4, y: 20 }),
      classId: 'taoist',
      hp: 20,
      mp: 60,
    });
    const witness = await createActor(db, 'Witness', {
      mapId: STARTER_WILDS_MAP_ID,
      position: tileUnits({ x: 5, y: 20 }),
    });
    const healerRoom = await createWorld(healer.ticket);
    await waitForMessage(healerRoom, 'combat.profile', (payload) =>
      combatProfileSchema.parse(payload),
    );
    const witnessRoom = await joinWorld(healerRoom.roomId, witness.ticket);
    await waitUntil(
      () => witnessRoom.state.players.get(witness.character.id) !== undefined,
      5_000,
      'witness joined',
    );

    const healerEvents = collectCombatEvents(healerRoom);
    const witnessEvents = collectCombatEvents(witnessRoom);
    healerRoom.send('skill.cast', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      skillId: 'taoist_heal',
      targetId: healer.character.id,
    });

    await waitUntil(
      () =>
        healerEvents.some(
          (event) => event.kind === 'heal' && event.targetId === healer.character.id,
        ),
      5_000,
      'heal event',
    );

    // A broadcast chat message reaches the witness after the heal would have;
    // socket ordering therefore proves the heal was never sent to it.
    const chat = waitForMessage(witnessRoom, 'chat.message', (payload) =>
      chatMessageSchema.parse(payload),
    );
    witnessRoom.send('chat.send', {
      protocolVersion: PROTOCOL_VERSION,
      clientMessageId: randomUUID(),
      message: '治疗事件归属验证',
    });
    await chat;

    expect(
      witnessEvents.filter(
        (event) => event.kind === 'heal' && event.targetId === healer.character.id,
      ),
    ).toEqual([]);
  });

  it('unlocks level-5 skills and broadcasts damage-over-time ticks', async () => {
    const actor = await wildsActor({ classId: 'taoist', level: 5 });
    const room = await createWorld(actor.ticket);
    const events = collectCombatEvents(room);

    const profile = await waitForMessage<CombatProfile>(room, 'combat.profile', (payload) =>
      combatProfileSchema.parse(payload),
    );
    expect(profile.skills.map((skill) => skill.id)).toEqual(['taoist_heal', 'taoist_poison']);

    await waitUntil(() => monsterState(room, SLIME) !== undefined, 5_000, 'slime visible');
    room.send('skill.cast', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      skillId: 'taoist_poison',
      targetId: SLIME,
    });

    await waitUntil(
      () => events.some((event) => event.kind === 'hit' && event.periodic === true),
      4_000,
      'first poison tick',
    );
    const tick = events.find((event) => event.kind === 'hit' && event.periodic === true);
    expect(tick?.kind).toBe('hit');
    if (tick?.kind !== 'hit') {
      return;
    }
    expect(tick.skillId).toBe('taoist_poison');
    expect(tick.sourceId).toBe(actor.character.id);

    await waitUntil(
      () =>
        events.some(
          (event) =>
            event.kind === 'death' &&
            event.entityId === SLIME &&
            event.killerId === actor.character.id,
        ),
      8_000,
      'poison kill',
    );
  });

  it('grants a shield that absorbs monster damage before HP', async () => {
    const actor = await wildsActor({ classId: 'warrior', level: 5 });
    const room = await createWorld(actor.ticket);
    const events = collectCombatEvents(room);

    await waitForMessage(room, 'combat.profile', (payload) => combatProfileSchema.parse(payload));
    await waitUntil(() => monsterState(room, SLIME) !== undefined, 5_000, 'slime visible');

    room.send('skill.cast', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      skillId: 'warrior_iron_skin',
      targetId: actor.character.id,
    });

    await waitUntil(
      () => events.some((event) => event.kind === 'shield' && event.amount > 0),
      3_000,
      'shield granted',
    );

    await waitUntil(
      () =>
        events.some(
          (event) =>
            event.kind === 'hit' &&
            event.targetId === actor.character.id &&
            (event.absorbed ?? 0) > 0,
        ),
      6_000,
      'absorbed hit',
    );
    const absorbed = events.find(
      (event): event is Extract<CombatEvent, { kind: 'hit' }> =>
        event.kind === 'hit' && event.targetId === actor.character.id && (event.absorbed ?? 0) > 0,
    );
    const hpAtShield = room.state.players.get(actor.character.id)?.hp ?? 0;
    expect(absorbed?.absorbed).toBeGreaterThan(0);
    expect(absorbed?.targetHp).toBe(hpAtShield);
  });
});
