import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  MONSTER_STATE_CODES,
  PROTOCOL_VERSION,
  STARTER_WILDS_MAP_ID,
  assetResultSchema,
  characterProgressSchema,
  combatProfileSchema,
  inventorySnapshotSchema,
  lootClaimedSchema,
  worldRoomNameFor,
  type AssetResult,
  type CharacterProgress,
  type CombatProfile,
  type InventorySnapshot,
  type LootClaimed,
} from '@web-legend/contracts';
import { WorldState, type WorldStateInstance } from '@web-legend/contracts/world-state';
import { createLogger } from '@web-legend/observability';
import {
  characterSessions,
  characters,
  createDatabase,
  currencyLedger,
  itemInstances,
  type Database,
  type DatabaseHandle,
} from '@web-legend/persistence';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { GameServerEnv } from '../src/env';
import { createGameServer, type GameServerRuntime } from '../src/server';
import {
  createActor,
  issueTicket,
  tileUnits,
  type CreateActorOptions,
  type TestActor,
} from './worldTestHelpers';

const databaseUrl = process.env.DATABASE_URL;
const SLIME = 'wilds_slime_2';

function requireDatabaseUrl(): string {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required for game server economy tests');
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

describe.runIf(databaseUrl !== undefined)('world_map economy', () => {
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
      await room.leave().catch(() => undefined);
    });
    return room;
  }

  async function waitForLeaseRelease(characterId: string): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5_000) {
      const [lease] = await db
        .select()
        .from(characterSessions)
        .where(eq(characterSessions.characterId, characterId))
        .limit(1);
      if (lease === undefined) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('character lease was not released');
  }

  function wildsActor(options: CreateActorOptions = {}): Promise<TestActor> {
    return createActor(db, 'Econ', {
      mapId: STARTER_WILDS_MAP_ID,
      position: tileUnits({ x: 7, y: 15 }),
      ...options,
    });
  }

  async function attackUntilDeath(room: WorldRoom, startSequence: number): Promise<number> {
    let sequence = startSequence;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (room.state.monsters.get(SLIME)?.state === MONSTER_STATE_CODES.dead) {
        return sequence;
      }
      const hpBefore = room.state.monsters.get(SLIME)?.hp ?? 0;
      room.send('combat.basicAttack', {
        protocolVersion: PROTOCOL_VERSION,
        commandId: randomUUID(),
        clientSequence: sequence,
        targetId: SLIME,
      });
      sequence += 1;
      await waitUntil(
        () => {
          const monster = room.state.monsters.get(SLIME);
          return (
            monster === undefined ||
            monster.state === MONSTER_STATE_CODES.dead ||
            monster.hp !== hpBefore
          );
        },
        2_000,
        `attack ${String(attempt)}`,
      );
      if (room.state.monsters.get(SLIME)?.state === MONSTER_STATE_CODES.dead) {
        return sequence;
      }
      await new Promise((resolve) => setTimeout(resolve, 950));
    }
    return sequence;
  }

  beforeAll(async () => {
    const port = await reservePort();
    database = createDatabase(requireDatabaseUrl(), { max: 8 });
    db = database.db;

    const env: GameServerEnv = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      GAME_SERVER_HOST: '127.0.0.1',
      GAME_SERVER_PORT: port,
      DATABASE_URL: requireDatabaseUrl(),
      GAME_SERVER_ID: 'game-server-economy-test',
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

  it('grants experience, gold and loot once, then commits a pickup', async () => {
    const actor = await wildsActor();
    const room = await createWorld(actor.ticket);
    const progressMessages: CharacterProgress[] = [];
    const inventoryMessages: InventorySnapshot[] = [];
    const assetResults: AssetResult[] = [];
    const claimedMessages: LootClaimed[] = [];
    room.onMessage('character.progress', (payload: unknown) => {
      progressMessages.push(characterProgressSchema.parse(payload));
    });
    room.onMessage('inventory.snapshot', (payload: unknown) => {
      inventoryMessages.push(inventorySnapshotSchema.parse(payload));
    });
    room.onMessage('asset.result', (payload: unknown) => {
      assetResults.push(assetResultSchema.parse(payload));
    });
    room.onMessage('loot.claimed', (payload: unknown) => {
      claimedMessages.push(lootClaimedSchema.parse(payload));
    });

    await waitUntil(() => room.state.monsters.get(SLIME) !== undefined, 5_000, 'slime visible');
    await waitUntil(() => inventoryMessages.length > 0, 5_000, 'inventory snapshot');

    const sequence = await attackUntilDeath(room, 0);
    await waitUntil(
      () => room.state.monsters.get(SLIME)?.state === MONSTER_STATE_CODES.dead,
      5_000,
      'monster dead',
    );
    await waitUntil(() => progressMessages.length > 0, 5_000, 'kill reward progress');
    const progress = progressMessages.at(-1);
    expect(progress?.exp).toBe(12);
    expect(progress?.gold).toBe(2);

    // The shared development database can still hold unexpired drops from
    // earlier tests; this kill's rewards are exactly the ones it owns.
    await waitUntil(
      () =>
        [...room.state.loot.values()].some(
          (drop) => drop.ownerId === actor.character.id && drop.templateId === 'slime_gel',
        ),
      5_000,
      'ground loot',
    );
    const drops = [...room.state.loot.values()].filter(
      (drop) => drop.ownerId === actor.character.id,
    );
    const gel = drops.find((drop) => drop.templateId === 'slime_gel');
    expect(gel).toBeDefined();
    expect(drops.map((drop) => drop.templateId).sort()).toEqual(['slime_gel', 'small_hp_potion']);

    const commandId = randomUUID();
    const pickupCommand = {
      protocolVersion: PROTOCOL_VERSION,
      commandId,
      clientSequence: sequence,
      dropId: gel!.dropId,
    };
    room.send('loot.pickup', pickupCommand);
    await waitUntil(() => assetResults.length > 0, 5_000, 'pickup result');
    const pickup = assetResults.at(-1);
    expect(pickup?.kind).toBe('loot_pickup');
    expect(pickup?.snapshot.items.some((item) => item.templateId === 'slime_gel')).toBe(true);
    await waitUntil(
      () => claimedMessages.some((message) => message.dropId === gel!.dropId),
      5_000,
      'claimed broadcast',
    );
    await waitUntil(() => !room.state.loot.has(gel!.dropId), 5_000, 'drop removed from state');

    // Retrying the exact command returns the committed snapshot instead of
    // moving a second instance.
    room.send('loot.pickup', pickupCommand);
    await waitUntil(() => assetResults.length > 1, 5_000, 'duplicate pickup result');
    const replay = assetResults.at(-1);
    expect(replay?.deduplicated).toBe(true);
    expect(replay?.snapshot.items.filter((item) => item.templateId === 'slime_gel')).toHaveLength(
      1,
    );

    const [stored] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, actor.character.id));
    expect(stored?.exp).toBe(12);
    const ledger = await db
      .select()
      .from(currencyLedger)
      .where(eq(currencyLedger.characterId, actor.character.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.balanceAfter).toBe(2);

    const bag = await db
      .select()
      .from(itemInstances)
      .where(
        and(
          eq(itemInstances.characterId, actor.character.id),
          eq(itemInstances.container, 'inventory'),
        ),
      );
    expect(bag.some((item) => item.templateId === 'slime_gel')).toBe(true);
  });

  it('equips a starter weapon, raises attack and persists the slot', async () => {
    const actor = await wildsActor();
    const [sword] = await db
      .insert(itemInstances)
      .values({
        templateId: 'warrior_sword',
        characterId: actor.character.id,
        container: 'inventory',
        slotIndex: 5,
        quantity: 1,
      })
      .returning();
    expect(sword).toBeDefined();

    const room = await createWorld(actor.ticket);
    const inventories: InventorySnapshot[] = [];
    const results: AssetResult[] = [];
    const profiles: CombatProfile[] = [];
    room.onMessage('inventory.snapshot', (payload: unknown) => {
      inventories.push(inventorySnapshotSchema.parse(payload));
    });
    room.onMessage('asset.result', (payload: unknown) => {
      results.push(assetResultSchema.parse(payload));
    });
    room.onMessage('combat.profile', (payload: unknown) => {
      profiles.push(combatProfileSchema.parse(payload));
    });

    await waitUntil(
      () =>
        inventories.some((snapshot) => snapshot.items.some((item) => item.itemId === sword!.id)),
      5_000,
      'starter weapon in the bag',
    );

    room.send('inventory.equip', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      itemId: sword!.id,
    });

    await waitUntil(() => results.length > 0, 5_000, 'equip result');
    const equipped = results.at(-1);
    expect(equipped?.kind).toBe('inventory_equip');
    expect(equipped?.snapshot.equipment.weapon?.itemId).toBe(sword!.id);
    expect(equipped?.snapshot.attack).toBe(18);
    expect(equipped?.snapshot.items.some((item) => item.itemId === sword!.id)).toBe(false);

    await waitUntil(
      () => profiles.some((profile) => profile.attack === 18),
      5_000,
      'combat profile attack update',
    );

    const equippedRows = await db
      .select()
      .from(itemInstances)
      .where(
        and(
          eq(itemInstances.characterId, actor.character.id),
          eq(itemInstances.container, 'equipment'),
        ),
      );
    expect(equippedRows).toHaveLength(1);
    expect(equippedRows[0]?.equipSlot).toBe('weapon');
    expect(equippedRows[0]?.templateId).toBe('warrior_sword');

    // A fresh ticket and room join loads the committed equipment again.
    await room.leave();
    await waitForLeaseRelease(actor.character.id);
    const ticket = await issueTicket(db, actor);
    const secondRoom = await createWorld(ticket);
    const reloaded = await waitForMessage<InventorySnapshot>(
      secondRoom,
      'inventory.snapshot',
      (payload) => inventorySnapshotSchema.parse(payload),
    );
    expect(reloaded.equipment.weapon?.templateId).toBe('warrior_sword');
    expect(reloaded.attack).toBe(18);
  });
});
