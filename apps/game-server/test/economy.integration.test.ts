import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  MONSTER_STATE_CODES,
  PROTOCOL_VERSION,
  STARTER_TOWN_MAP_ID,
  STARTER_WILDS_MAP_ID,
  assetResultSchema,
  characterProgressSchema,
  combatProfileSchema,
  commandRejectedSchema,
  inventorySnapshotSchema,
  lootClaimedSchema,
  questSnapshotSchema,
  questUpdateSchema,
  shopCatalogSchema,
  worldRoomNameFor,
  type AssetResult,
  type CharacterProgress,
  type CommandRejected,
  type CombatProfile,
  type ContentBundle,
  type InventorySnapshot,
  type LootClaimed,
  type QuestSnapshot,
  type QuestUpdate,
  type ShopCatalog,
} from '@web-legend/contracts';
import { BASE_CONTENT_BUNDLE, contentChecksum } from '@web-legend/content-schema';
import { WorldState, type WorldStateInstance } from '@web-legend/contracts/world-state';
import { createLogger } from '@web-legend/observability';
import {
  characterSessions,
  characters,
  createDatabase,
  currencyLedger,
  insertCharacterQuest,
  itemInstances,
  listCharacterQuests,
  type Database,
  type DatabaseHandle,
} from '@web-legend/persistence';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { GameServerEnv } from '../src/env';
import { createGameServer, type GameServerRuntime } from '../src/server';
import type { ContentProvider } from '../src/world/contentStore';
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

  async function createWorld(
    ticket: string,
    mapId: string = STARTER_WILDS_MAP_ID,
  ): Promise<WorldRoom> {
    const room = (await client().create(
      worldRoomNameFor(mapId),
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

  function townActor(options: CreateActorOptions = {}): Promise<TestActor> {
    // (9,8) is exactly SHOP_RANGE_TILES (3) from the merchant at (12,8); the
    // main buy/sell test therefore exercises the inclusive boundary.
    return createActor(db, 'Shop', {
      mapId: STARTER_TOWN_MAP_ID,
      position: tileUnits({ x: 9, y: 8 }),
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
      GAME_SERVER_REALM: 'classic-01',
      INTERNAL_ADMIN_TOKEN: 'test-internal-admin-token-123',
    };

    // Priced class weapons let the tests exercise the offer filter and the
    // authoritative CLASS_RESTRICTED path without shipping them in content.
    const bundle = JSON.parse(JSON.stringify(BASE_CONTENT_BUNDLE)) as ContentBundle;
    const warriorSword = bundle.items['warrior_sword'];
    const mageStaff = bundle.items['mage_staff'];
    if (warriorSword === undefined || mageStaff === undefined) {
      throw new Error('baseline content is missing a class weapon');
    }
    warriorSword.buyPrice = 100;
    mageStaff.buyPrice = 100;
    const contentStore: ContentProvider = {
      snapshot: () => ({
        version: 'test-shop',
        checksum: contentChecksum(bundle),
        bundle,
      }),
      start: () => Promise.resolve(),
      stop: () => undefined,
    };

    runtime = createGameServer({
      env,
      logger: logger(),
      database: db,
      contentStore,
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

  it('serves the town merchant catalog and settles buy and sell over the socket', async () => {
    const actor = await townActor({ gold: 100 });
    const room = await createWorld(actor.ticket, STARTER_TOWN_MAP_ID);
    const catalogs: ShopCatalog[] = [];
    const results: AssetResult[] = [];
    room.onMessage('shop.catalog', (payload: unknown) => {
      catalogs.push(shopCatalogSchema.parse(payload));
    });
    room.onMessage('asset.result', (payload: unknown) => {
      results.push(assetResultSchema.parse(payload));
    });

    await waitUntil(() => catalogs.length > 0, 5_000, 'shop catalog');
    const catalog = catalogs[0];
    expect(catalog?.merchants.map((merchant) => merchant.id)).toContain('town_merchant');
    expect(catalog?.offers.find((offer) => offer.templateId === 'small_hp_potion')?.buyPrice).toBe(
      15,
    );
    expect(catalog?.sellPrices.find((price) => price.templateId === 'slime_gel')?.sellPrice).toBe(
      4,
    );

    const buyCommandId = randomUUID();
    room.send('shop.buy', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: buyCommandId,
      clientSequence: 0,
      merchantId: 'town_merchant',
      templateId: 'small_hp_potion',
      quantity: 1,
    });
    await waitUntil(() => results.length > 0, 5_000, 'buy result');
    expect(results[0]?.kind).toBe('shop_buy');
    expect(results[0]?.snapshot.gold).toBe(85);
    const potion = results[0]?.snapshot.items.find((item) => item.templateId === 'small_hp_potion');
    expect(potion?.quantity).toBe(1);

    room.send('shop.buy', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: buyCommandId,
      clientSequence: 0,
      merchantId: 'town_merchant',
      templateId: 'small_hp_potion',
      quantity: 1,
    });
    await waitUntil(() => results.length > 1, 5_000, 'duplicate buy result');
    expect(results[1]?.deduplicated).toBe(true);
    expect(results[1]?.snapshot.gold).toBe(85);

    const sellItem = results[1]?.snapshot.items.find(
      (item) => item.templateId === 'small_hp_potion',
    );
    expect(sellItem).toBeDefined();
    room.send('shop.sell', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 1,
      merchantId: 'town_merchant',
      itemId: sellItem!.itemId,
      quantity: 1,
    });
    await waitUntil(() => results.length > 2, 5_000, 'sell result');
    expect(results[2]?.kind).toBe('shop_sell');
    expect(results[2]?.snapshot.gold).toBe(90);
    expect(results[2]?.snapshot.items.some((item) => item.itemId === sellItem!.itemId)).toBe(false);
  });

  it('rejects shop commands away from the merchant or for the wrong NPC', async () => {
    const far = await createActor(db, 'FarS', { mapId: STARTER_TOWN_MAP_ID, gold: 100 });
    const farRoom = await createWorld(far.ticket, STARTER_TOWN_MAP_ID);
    const farRejections: CommandRejected[] = [];
    farRoom.onMessage('command.rejected', (payload: unknown) => {
      farRejections.push(commandRejectedSchema.parse(payload));
    });
    await waitUntil(
      () => farRoom.state.players.get(far.character.id) !== undefined,
      5_000,
      'far player joined',
    );
    farRoom.send('shop.buy', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      merchantId: 'town_merchant',
      templateId: 'small_hp_potion',
      quantity: 1,
    });
    await waitUntil(() => farRejections.length > 0, 5_000, 'far rejection');
    expect(farRejections[0]?.code).toBe('SHOP_UNAVAILABLE');

    const near = await townActor({ gold: 100 });
    const nearRoom = await createWorld(near.ticket, STARTER_TOWN_MAP_ID);
    const nearRejections: CommandRejected[] = [];
    nearRoom.onMessage('command.rejected', (payload: unknown) => {
      nearRejections.push(commandRejectedSchema.parse(payload));
    });
    await waitUntil(
      () => nearRoom.state.players.get(near.character.id) !== undefined,
      5_000,
      'near player joined',
    );
    nearRoom.send('shop.buy', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      merchantId: 'town_guard',
      templateId: 'small_hp_potion',
      quantity: 1,
    });
    await waitUntil(() => nearRejections.length > 0, 5_000, 'wrong merchant rejection');
    expect(nearRejections[0]?.code).toBe('SHOP_UNAVAILABLE');
  });

  it('filters class-restricted offers and rejects cross-class purchases', async () => {
    const mage = await townActor({ classId: 'mage', gold: 200 });
    const mageRoom = await createWorld(mage.ticket, STARTER_TOWN_MAP_ID);
    const mageCatalogs: ShopCatalog[] = [];
    const mageRejections: CommandRejected[] = [];
    mageRoom.onMessage('shop.catalog', (payload: unknown) => {
      mageCatalogs.push(shopCatalogSchema.parse(payload));
    });
    mageRoom.onMessage('command.rejected', (payload: unknown) => {
      mageRejections.push(commandRejectedSchema.parse(payload));
    });
    await waitUntil(() => mageCatalogs.length > 0, 5_000, 'mage catalog');
    expect(mageCatalogs[0]?.offers.some((offer) => offer.templateId === 'mage_staff')).toBe(true);
    expect(mageCatalogs[0]?.offers.some((offer) => offer.templateId === 'warrior_sword')).toBe(
      false,
    );

    mageRoom.send('shop.buy', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      merchantId: 'town_merchant',
      templateId: 'warrior_sword',
      quantity: 1,
    });
    await waitUntil(() => mageRejections.length > 0, 5_000, 'class rejection');
    expect(mageRejections[0]?.code).toBe('CLASS_RESTRICTED');

    const warrior = await townActor({ classId: 'warrior', gold: 200 });
    const warriorRoom = await createWorld(warrior.ticket, STARTER_TOWN_MAP_ID);
    const warriorCatalogs: ShopCatalog[] = [];
    warriorRoom.onMessage('shop.catalog', (payload: unknown) => {
      warriorCatalogs.push(shopCatalogSchema.parse(payload));
    });
    await waitUntil(() => warriorCatalogs.length > 0, 5_000, 'warrior catalog');
    expect(warriorCatalogs[0]?.offers.some((offer) => offer.templateId === 'warrior_sword')).toBe(
      true,
    );
    expect(warriorCatalogs[0]?.offers.some((offer) => offer.templateId === 'mage_staff')).toBe(
      false,
    );
  });

  it('serves quests at the guard and accepts one idempotently', async () => {
    // (24,12) is inside QUEST_NPC_RANGE_TILES of the guard at (26,12).
    const actor = await createActor(db, 'Quest', {
      mapId: STARTER_TOWN_MAP_ID,
      position: tileUnits({ x: 24, y: 12 }),
    });
    const room = await createWorld(actor.ticket, STARTER_TOWN_MAP_ID);
    const snapshots: QuestSnapshot[] = [];
    const updates: QuestUpdate[] = [];
    const results: AssetResult[] = [];
    const rejections: CommandRejected[] = [];
    room.onMessage('quest.snapshot', (payload: unknown) => {
      snapshots.push(questSnapshotSchema.parse(payload));
    });
    room.onMessage('quest.update', (payload: unknown) => {
      updates.push(questUpdateSchema.parse(payload));
    });
    room.onMessage('asset.result', (payload: unknown) => {
      results.push(assetResultSchema.parse(payload));
    });
    room.onMessage('command.rejected', (payload: unknown) => {
      rejections.push(commandRejectedSchema.parse(payload));
    });

    await waitUntil(() => snapshots.length > 0, 5_000, 'quest snapshot');
    const firstQuest = snapshots[0]?.quests.find(
      (quest) => quest.questId === 'quest_slime_cleanup',
    );
    expect(firstQuest?.status).toBe('available');
    expect(firstQuest?.giverNpcId).toBe('town_guard');
    expect(firstQuest?.objective.monsterName).toBe('野地史莱姆');

    const dailyQuest = snapshots[0]?.quests.find(
      (quest) => quest.questId === 'quest_daily_slime_cleanup',
    );
    expect(dailyQuest?.status).toBe('available');
    expect(dailyQuest?.repeat).toBe('daily');
    expect(dailyQuest?.nextResetAt).toBeGreaterThan(Date.now());

    const commandId = randomUUID();
    room.send('quest.accept', {
      protocolVersion: PROTOCOL_VERSION,
      commandId,
      clientSequence: 0,
      questId: 'quest_slime_cleanup',
    });
    await waitUntil(() => updates.length > 0, 5_000, 'accept update');
    expect(updates[0]?.quest.status).toBe('active');
    expect(updates[0]?.quest.progress).toBe(0);
    await waitUntil(() => results.length > 0, 5_000, 'accept asset result');
    expect(results[0]?.kind).toBe('quest_accept');

    room.send('quest.accept', {
      protocolVersion: PROTOCOL_VERSION,
      commandId,
      clientSequence: 0,
      questId: 'quest_slime_cleanup',
    });
    await waitUntil(() => results.length > 1, 5_000, 'duplicate accept result');
    expect(results[1]?.deduplicated).toBe(true);
    expect(await listCharacterQuests(db, actor.character.id)).toHaveLength(1);

    // The second quest needs level 3 and the first quest claimed.
    room.send('quest.accept', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 1,
      questId: 'quest_wolf_patrol',
    });
    await waitUntil(() => rejections.length > 0, 5_000, 'locked quest rejection');
    expect(rejections[0]?.code).toBe('QUEST_UNAVAILABLE');
  });

  it('rejects quest commands away from the giver', async () => {
    const actor = await townActor();
    const room = await createWorld(actor.ticket, STARTER_TOWN_MAP_ID);
    const rejections: CommandRejected[] = [];
    room.onMessage('command.rejected', (payload: unknown) => {
      rejections.push(commandRejectedSchema.parse(payload));
    });
    await waitUntil(
      () => room.state.players.get(actor.character.id) !== undefined,
      5_000,
      'player joined',
    );
    room.send('quest.accept', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: 0,
      questId: 'quest_slime_cleanup',
    });
    await waitUntil(() => rejections.length > 0, 5_000, 'distance rejection');
    expect(rejections[0]?.code).toBe('OUT_OF_RANGE');
  });

  it('advances kill progress in combat and keeps it across a rejoin', async () => {
    const actor = await wildsActor();
    await insertCharacterQuest(db, {
      characterId: actor.character.id,
      questId: 'quest_slime_cleanup',
      periodKey: '',
      now: new Date(),
    });
    const room = await createWorld(actor.ticket);
    const updates: QuestUpdate[] = [];
    const snapshots: QuestSnapshot[] = [];
    room.onMessage('quest.update', (payload: unknown) => {
      updates.push(questUpdateSchema.parse(payload));
    });
    room.onMessage('quest.snapshot', (payload: unknown) => {
      snapshots.push(questSnapshotSchema.parse(payload));
    });
    await waitUntil(() => snapshots.length > 0, 5_000, 'quest snapshot');
    expect(
      snapshots[0]?.quests.find((quest) => quest.questId === 'quest_slime_cleanup')?.status,
    ).toBe('active');

    let sequence = 0;
    for (let kill = 0; kill < 3; kill += 1) {
      await waitUntil(
        () => room.state.monsters.get(SLIME) !== undefined,
        5_000,
        `slime ${String(kill)} visible`,
      );
      await waitUntil(
        () => room.state.monsters.get(SLIME)?.state !== MONSTER_STATE_CODES.dead,
        5_000,
        `slime ${String(kill)} alive`,
      );
      sequence = await attackUntilDeath(room, sequence);
      await waitUntil(
        () => updates.at(-1)?.quest.progress === kill + 1,
        5_000,
        `quest progress ${String(kill + 1)}`,
      );
      if (kill < 2) {
        await waitUntil(
          () => room.state.monsters.get(SLIME)?.state !== MONSTER_STATE_CODES.dead,
          5_000,
          `slime ${String(kill)} respawn`,
        );
      }
    }
    expect(updates.at(-1)?.quest.status).toBe('completed');
    expect(updates.at(-1)?.quest.progress).toBe(3);

    await room.leave();
    await waitForLeaseRelease(actor.character.id);
    const ticket = await issueTicket(db, actor);
    const secondRoom = await createWorld(ticket);
    const reloaded = await waitForMessage<QuestSnapshot>(secondRoom, 'quest.snapshot', (payload) =>
      questSnapshotSchema.parse(payload),
    );
    const quest = reloaded.quests.find((entry) => entry.questId === 'quest_slime_cleanup');
    expect(quest?.status).toBe('completed');
    expect(quest?.progress).toBe(3);
  }, 60_000);
});
