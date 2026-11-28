import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  PROTOCOL_VERSION,
  STARTER_TOWN_MAP_ID,
  commandRejectedSchema,
  inventorySnapshotSchema,
  systemNoticeSchema,
  tradeInviteViewSchema,
  tradeStateSchema,
  worldRoomNameFor,
  type CommandRejected,
  type InventorySnapshot,
  type SystemNotice,
  type TradeInviteView,
  type TradeState,
} from '@web-legend/contracts';
import { WorldState, type WorldStateInstance } from '@web-legend/contracts/world-state';
import { createLogger } from '@web-legend/observability';
import {
  createDatabase,
  itemInstances,
  wallets,
  type Database,
  type DatabaseHandle,
} from '@web-legend/persistence';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { GameServerEnv } from '../src/env';
import { createGameServer, type GameServerRuntime } from '../src/server';
import { createActor, tileUnits, type TestActor } from './worldTestHelpers';

const databaseUrl = process.env.DATABASE_URL;

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
      probe.close((error) => (error === undefined ? resolve(port) : reject(error)));
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
  predicate: (value: T) => boolean = () => true,
  timeoutMs = 5_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for "${type}"`));
    }, timeoutMs);
    unsubscribe = room.onMessage(type, (payload: unknown) => {
      let parsed: T;
      try {
        parsed = parse(payload);
      } catch (error) {
        clearTimeout(timer);
        unsubscribe();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (!predicate(parsed)) {
        return;
      }
      clearTimeout(timer);
      unsubscribe();
      resolve(parsed);
    });
  });
}

function waitForTradeState(
  room: SdkRoom,
  predicate: (state: TradeState) => boolean,
  timeoutMs = 5_000,
): Promise<TradeState> {
  return waitForMessage(
    room,
    'trade.state',
    (payload) => tradeStateSchema.parse(payload),
    predicate,
    timeoutMs,
  );
}

function waitForInventory(
  room: SdkRoom,
  predicate: (snapshot: InventorySnapshot) => boolean,
  timeoutMs = 5_000,
): Promise<InventorySnapshot> {
  return waitForMessage(
    room,
    'inventory.snapshot',
    (payload) => inventorySnapshotSchema.parse(payload),
    predicate,
    timeoutMs,
  );
}

type WorldRoom = SdkRoom<unknown, WorldStateInstance>;

function joinOptions(ticket: string): Record<string, unknown> {
  return { protocolVersion: PROTOCOL_VERSION, ticket };
}

describe.runIf(databaseUrl !== undefined)('world_map face-to-face trade', () => {
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

  async function createTown(ticket: string): Promise<WorldRoom> {
    const room = (await client().create(
      worldRoomNameFor(STARTER_TOWN_MAP_ID),
      joinOptions(ticket),
      WorldState,
    )) as WorldRoom;
    cleanups.push(async () => {
      await room.leave();
    });
    return room;
  }

  async function joinTown(roomId: string, ticket: string): Promise<WorldRoom> {
    const room = (await client().joinById(roomId, joinOptions(ticket), WorldState)) as WorldRoom;
    cleanups.push(async () => {
      await room.leave();
    });
    return room;
  }

  async function actorInTown(
    position: { x: number; y: number },
    options: { gold?: number } = {},
  ): Promise<TestActor> {
    return createActor(db, 'Trade', {
      mapId: STARTER_TOWN_MAP_ID,
      position: tileUnits(position),
      ...options,
    });
  }

  async function giveItem(
    actor: TestActor,
    templateId: string,
    quantity: number,
    slotIndex: number,
  ): Promise<{ id: string; quantity: number }> {
    const [row] = await db
      .insert(itemInstances)
      .values({
        templateId,
        characterId: actor.character.id,
        container: 'inventory',
        slotIndex,
        quantity,
      })
      .returning({ id: itemInstances.id });
    if (row === undefined) {
      throw new Error('item insert returned no row');
    }
    return { id: row.id, quantity };
  }

  async function walletBalance(characterId: string): Promise<number> {
    const [row] = await db.select().from(wallets).where(eq(wallets.characterId, characterId));
    return row?.balance ?? 0;
  }

  async function twoPlayersInOneRoom(options: { aliceGold?: number; bobGold?: number } = {}) {
    const alice = await actorInTown({ x: 2, y: 16 }, { gold: options.aliceGold ?? 100 });
    const alicePotion = await giveItem(alice, 'small_hp_potion', 3, 0);
    const bob = await actorInTown({ x: 4, y: 16 }, { gold: options.bobGold ?? 10 });
    const bobPotion = await giveItem(bob, 'small_mp_potion', 3, 0);
    const aliceRoom = await createTown(alice.ticket);
    await waitUntil(() => aliceRoom.state.players.has(alice.character.id), 10_000, 'alice joined');
    const bobRoom = await joinTown(aliceRoom.roomId, bob.ticket);
    await waitUntil(() => bobRoom.state.players.has(bob.character.id), 10_000, 'bob joined');
    return { alice, bob, aliceRoom, bobRoom, alicePotion, bobPotion };
  }

  async function invite(
    aliceRoom: WorldRoom,
    bobRoom: WorldRoom,
    alice: TestActor,
    bob: TestActor,
  ): Promise<TradeInviteView> {
    const invited = waitForMessage(bobRoom, 'trade.invite', (payload) =>
      tradeInviteViewSchema.parse(payload),
    );
    aliceRoom.send('trade.invite', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      targetPlayerId: bob.character.id,
    });
    const inviteView = await invited;
    expect(inviteView.fromPlayerId).toBe(alice.character.id);
    return inviteView;
  }

  async function accept(
    bobRoom: WorldRoom,
    aliceRoom: WorldRoom,
    inviteView: TradeInviteView,
  ): Promise<TradeState> {
    const aliceOpened = waitForTradeState(aliceRoom, (state) => state.status === 'open');
    const bobOpened = waitForTradeState(bobRoom, (state) => state.status === 'open');
    bobRoom.send('trade.accept', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      inviteId: inviteView.inviteId,
    });
    const [aliceState] = await Promise.all([aliceOpened, bobOpened]);
    return aliceState;
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
      GAME_SERVER_ID: 'game-server-trade-test',
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
        autoPickup: false,
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

  it('swaps items and gold after both players lock their offers', async () => {
    const { alice, bob, aliceRoom, bobRoom, alicePotion, bobPotion } = await twoPlayersInOneRoom();
    const inviteView = await invite(aliceRoom, bobRoom, alice, bob);
    const opened = await accept(bobRoom, aliceRoom, inviteView);

    const aliceOffered = waitForTradeState(
      aliceRoom,
      (state) => state.status === 'open' && state.selfItems.length === 1,
    );
    const bobSawOffer = waitForTradeState(
      bobRoom,
      (state) => state.status === 'open' && state.otherItems.length === 1,
    );
    aliceRoom.send('trade.offer', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      tradeId: opened.tradeId,
      itemIds: [alicePotion.id],
      gold: 25,
    });
    const [aliceOfferState, bobOfferState] = await Promise.all([aliceOffered, bobSawOffer]);
    expect(aliceOfferState.selfGold).toBe(25);
    expect(bobOfferState.otherItems[0]?.quantity).toBe(3);

    const bobOffered = waitForTradeState(
      bobRoom,
      (state) => state.status === 'open' && state.selfItems.length === 1,
    );
    bobRoom.send('trade.offer', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      tradeId: opened.tradeId,
      itemIds: [bobPotion.id],
      gold: 0,
    });
    await bobOffered;

    const aliceLocked = waitForTradeState(
      aliceRoom,
      (state) => state.status === 'open' && state.selfLocked,
    );
    aliceRoom.send('trade.lock', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      tradeId: opened.tradeId,
    });
    await aliceLocked;

    const aliceSettling = waitForTradeState(aliceRoom, (state) => state.status === 'settling');
    const bobSettling = waitForTradeState(bobRoom, (state) => state.status === 'settling');
    const aliceCompleted = waitForTradeState(aliceRoom, (state) => state.status === 'completed');
    const bobCompleted = waitForTradeState(bobRoom, (state) => state.status === 'completed');
    const aliceInventory = waitForInventory(aliceRoom, (snapshot) => snapshot.gold === 75);
    const bobInventory = waitForInventory(bobRoom, (snapshot) => snapshot.gold === 35);
    bobRoom.send('trade.lock', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      tradeId: opened.tradeId,
    });

    const [settlingState, , aliceDone, bobDone, aliceBag, bobBag] = await Promise.all([
      aliceSettling,
      bobSettling,
      aliceCompleted,
      bobCompleted,
      aliceInventory,
      bobInventory,
    ]);
    expect(settlingState.selfLocked).toBe(true);
    expect(settlingState.otherLocked).toBe(true);
    expect(aliceDone.closeReason).toBe('completed');
    expect(bobDone.closeReason).toBe('completed');
    expect(aliceBag.items.find((item) => item.templateId === 'small_mp_potion')?.quantity).toBe(3);
    expect(aliceBag.items.some((item) => item.templateId === 'small_hp_potion')).toBe(false);
    expect(bobBag.items.find((item) => item.templateId === 'small_hp_potion')?.quantity).toBe(3);
    expect(bobBag.items.some((item) => item.templateId === 'small_mp_potion')).toBe(false);
    expect(await walletBalance(alice.character.id)).toBe(75);
    expect(await walletBalance(bob.character.id)).toBe(35);

    // The final snapshot is private; the room state never exposes trade data.
    expect((aliceRoom.state as unknown as Record<string, unknown>).trade).toBeUndefined();
  });

  it('rejects self, absent and out-of-range targets', async () => {
    const { alice, aliceRoom } = await twoPlayersInOneRoom();
    const selfRejection = waitForMessage(
      aliceRoom,
      'command.rejected',
      (payload) => commandRejectedSchema.parse(payload),
      (rejected: CommandRejected) => rejected.code === 'TRADE_SELF',
    );
    aliceRoom.send('trade.invite', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      targetPlayerId: alice.character.id,
    });
    expect((await selfRejection).code).toBe('TRADE_SELF');

    const absent = await actorInTown({ x: 3, y: 16 });
    const absentRejection = waitForMessage(
      aliceRoom,
      'command.rejected',
      (payload) => commandRejectedSchema.parse(payload),
      (rejected: CommandRejected) => rejected.code === 'TRADE_TARGET_UNAVAILABLE',
    );
    aliceRoom.send('trade.invite', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      targetPlayerId: absent.character.id,
    });
    expect((await absentRejection).code).toBe('TRADE_TARGET_UNAVAILABLE');

    const far = await actorInTown({ x: 20, y: 20 });
    const farRoom = await joinTown(aliceRoom.roomId, far.ticket);
    await waitUntil(() => farRoom.state.players.has(far.character.id), 10_000, 'far joined');
    const farRejection = waitForMessage(
      aliceRoom,
      'command.rejected',
      (payload) => commandRejectedSchema.parse(payload),
      (rejected: CommandRejected) => rejected.code === 'TRADE_OUT_OF_RANGE',
    );
    aliceRoom.send('trade.invite', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      targetPlayerId: far.character.id,
    });
    expect((await farRejection).code).toBe('TRADE_OUT_OF_RANGE');
  });

  it('lets the invited player decline and notifies the inviter', async () => {
    const { alice, bob, aliceRoom, bobRoom } = await twoPlayersInOneRoom();
    const inviteView = await invite(aliceRoom, bobRoom, alice, bob);
    const declinedNotice = waitForMessage(
      aliceRoom,
      'system.notice',
      (payload) => systemNoticeSchema.parse(payload),
      (notice: SystemNotice) => notice.message.includes('拒绝'),
    );
    bobRoom.send('trade.decline', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      inviteId: inviteView.inviteId,
    });
    const notice = await declinedNotice;
    expect(notice.message).toContain('拒绝');
  });

  it('unlocks both sides when an offer changes after one lock', async () => {
    const { alice, bob, aliceRoom, bobRoom, bobPotion } = await twoPlayersInOneRoom();
    const inviteView = await invite(aliceRoom, bobRoom, alice, bob);
    const opened = await accept(bobRoom, aliceRoom, inviteView);

    const bobOffered = waitForTradeState(
      bobRoom,
      (state) => state.status === 'open' && state.selfItems.length === 1,
    );
    bobRoom.send('trade.offer', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      tradeId: opened.tradeId,
      itemIds: [bobPotion.id],
      gold: 0,
    });
    await bobOffered;

    const bobLocked = waitForTradeState(
      bobRoom,
      (state) => state.status === 'open' && state.selfLocked,
    );
    const aliceSeesLock = waitForTradeState(
      aliceRoom,
      (state) => state.status === 'open' && state.otherLocked,
    );
    bobRoom.send('trade.lock', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      tradeId: opened.tradeId,
    });
    await Promise.all([bobLocked, aliceSeesLock]);

    const aliceUnlocked = waitForTradeState(
      aliceRoom,
      (state) => state.status === 'open' && state.selfItems.length === 0 && !state.selfLocked,
    );
    const bobUnlocked = waitForTradeState(
      bobRoom,
      (state) => state.status === 'open' && !state.selfLocked && !state.otherLocked,
    );
    aliceRoom.send('trade.offer', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      tradeId: opened.tradeId,
      itemIds: [],
      gold: 0,
    });
    await Promise.all([aliceUnlocked, bobUnlocked]);
  });

  it('cancels the trade for both players on request', async () => {
    const { alice, bob, aliceRoom, bobRoom } = await twoPlayersInOneRoom();
    const inviteView = await invite(aliceRoom, bobRoom, alice, bob);
    const opened = await accept(bobRoom, aliceRoom, inviteView);

    const aliceCancelled = waitForTradeState(aliceRoom, (state) => state.status === 'cancelled');
    const bobCancelled = waitForTradeState(bobRoom, (state) => state.status === 'cancelled');
    aliceRoom.send('trade.cancel', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      tradeId: opened.tradeId,
    });
    const [aliceState, bobState] = await Promise.all([aliceCancelled, bobCancelled]);
    expect(aliceState.closeReason).toBe('cancelled');
    expect(bobState.closeReason).toBe('cancelled');
  });

  it('cancels the trade when one player leaves the map', async () => {
    const { alice, bob, aliceRoom, bobRoom } = await twoPlayersInOneRoom();
    const inviteView = await invite(aliceRoom, bobRoom, alice, bob);
    await accept(bobRoom, aliceRoom, inviteView);

    const aliceCancelled = waitForTradeState(
      aliceRoom,
      (state) => state.status === 'cancelled' && state.closeReason === 'player_left',
      10_000,
    );
    await bobRoom.leave();
    const cancelled = await aliceCancelled;
    expect(cancelled.closeReason).toBe('player_left');
  });
});
