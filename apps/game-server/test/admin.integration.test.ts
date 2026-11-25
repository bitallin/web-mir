import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  PROTOCOL_VERSION,
  SERVER_MESSAGES,
  STARTER_TOWN_MAP_ID,
  STARTER_WILDS_MAP_ID,
  adminCommandReceiptSchema,
  adminGameServerStatusSchema,
  chatMessageSchema,
  sessionKickedSchema,
  systemNoticeSchema,
  worldRoomNameFor,
} from '@web-legend/contracts';
import { WorldState, type WorldStateInstance } from '@web-legend/contracts/world-state';
import { BASE_CONTENT_BUNDLE, contentChecksum } from '@web-legend/content-schema';
import type { ContentBundle } from '@web-legend/contracts';
import { createLogger } from '@web-legend/observability';
import {
  accounts,
  createDatabase,
  type Database,
  type DatabaseHandle,
} from '@web-legend/persistence';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { GameServerEnv } from '../src/env';
import { createGameServer, type GameServerRuntime } from '../src/server';
import { createActor, type TestActor } from './worldTestHelpers';

const databaseUrl = process.env.DATABASE_URL;
const INTERNAL_TOKEN = 'test-internal-admin-token-123';

function requireDatabaseUrl(): string {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required for game server admin integration tests');
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

type WorldRoom = SdkRoom<unknown, WorldStateInstance>;

function waitForMessage<T>(
  room: WorldRoom,
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

function waitForLeave(room: WorldRoom): Promise<number> {
  return new Promise<number>((resolve) => {
    room.onLeave((code: number) => {
      resolve(code);
    });
  });
}

function joinOptions(ticket: string): Record<string, unknown> {
  return { protocolVersion: PROTOCOL_VERSION, ticket };
}

describe.runIf(databaseUrl !== undefined)('admin command delivery to the game server', () => {
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
      worldRoomNameFor(STARTER_TOWN_MAP_ID),
      joinOptions(ticket),
      WorldState,
    )) as WorldRoom;
    cleanups.push(async () => {
      await room.leave();
    });
    return room;
  }

  async function postCommand(
    body: Record<string, unknown>,
    token: string = INTERNAL_TOKEN,
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${baseUrl}/internal/admin/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-admin-token': token,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  async function status(
    token: string = INTERNAL_TOKEN,
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${baseUrl}/internal/admin/status`, {
      headers: { 'x-internal-admin-token': token },
    });
    return { status: response.status, body: await response.json() };
  }

  async function joinActor(actor: TestActor): Promise<WorldRoom> {
    const room = await createWorld(actor.ticket);
    await waitUntil(
      () => room.state.players.get(actor.character.id) !== undefined,
      5_000,
      'actor joined',
    );
    return room;
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
      GAME_SERVER_ID: 'game-server-admin-test',
      GAME_SERVER_REALM: 'classic-01',
      INTERNAL_ADMIN_TOKEN: INTERNAL_TOKEN,
    };
    runtime = createGameServer({
      env,
      logger: logger(),
      database: db,
      world: { reconnectGraceSeconds: 1, checkpointIntervalMs: 250 },
      contentRefreshMs: 200,
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

  it('rejects internal requests without the shared token', async () => {
    const unauthorized = await status('wrong-token');
    expect(unauthorized.status).toBe(401);

    const unauthorizedCommand = await postCommand(
      { commandId: randomUUID(), type: 'kick', characterId: randomUUID() },
      'wrong-token',
    );
    expect(unauthorizedCommand.status).toBe(401);
  });

  it('reports rooms with their fixed content version', async () => {
    const actor = await createActor(db, 'AdminStatus');
    await joinActor(actor);

    const response = await status();
    expect(response.status).toBe(200);
    const parsed = adminGameServerStatusSchema.parse(response.body);
    expect(parsed.rooms.length).toBeGreaterThan(0);
    const room = parsed.rooms.find((entry) => entry.mapId === STARTER_TOWN_MAP_ID);
    expect(room).toBeDefined();
    expect(room?.contentVersion.length).toBeGreaterThan(0);
    expect(room?.contentChecksum).toHaveLength(64);
    expect(parsed.totals.players).toBeGreaterThanOrEqual(1);
  });

  it('kicks an online character exactly once for a repeated command id', async () => {
    const actor = await createActor(db, 'AdminKick');
    const room = await joinActor(actor);
    const commandId = randomUUID();

    const kicked = waitForMessage(room, SERVER_MESSAGES.sessionKicked, (payload) =>
      sessionKickedSchema.parse(payload),
    );
    const left = waitForLeave(room);

    const first = await postCommand({
      commandId,
      type: 'kick',
      characterId: actor.character.id,
      reason: '管理员测试踢下线',
      issuedAt: new Date().toISOString(),
    });
    expect(first.status).toBe(200);
    const receipt = adminCommandReceiptSchema.parse(first.body);
    expect(receipt.status).toBe('applied');
    expect(receipt.applied).toBe(1);

    const notice = await kicked;
    expect(notice.kind).toBe('kicked');
    expect(notice.reason).toContain('踢下线');
    await left;

    const second = await postCommand({
      commandId,
      type: 'kick',
      characterId: actor.character.id,
      reason: '管理员测试踢下线',
      issuedAt: new Date().toISOString(),
    });
    const duplicate = adminCommandReceiptSchema.parse(second.body);
    expect(duplicate.status).toBe('duplicate');
    expect(duplicate.applied).toBe(0);
  });

  it('blocks chat while muted and restores it when the mute expires', async () => {
    const actor = await createActor(db, 'AdminMute');
    const room = await joinActor(actor);

    const muteNotice = waitForMessage(room, SERVER_MESSAGES.systemNotice, (payload) =>
      systemNoticeSchema.parse(payload),
    );
    const muted = await postCommand({
      commandId: randomUUID(),
      type: 'mute',
      accountId: actor.accountId,
      mutedUntil: new Date(Date.now() + 60_000).toISOString(),
      reason: '管理员测试禁言',
      issuedAt: new Date().toISOString(),
    });
    expect(adminCommandReceiptSchema.parse(muted.body).applied).toBe(1);
    expect((await muteNotice).message).toContain('禁言');

    const blocked = waitForMessage(room, SERVER_MESSAGES.systemNotice, (payload) =>
      systemNoticeSchema.parse(payload),
    );
    room.send('chat.send', {
      protocolVersion: PROTOCOL_VERSION,
      clientMessageId: randomUUID(),
      message: '这条消息应该被禁言拦截',
    });
    expect((await blocked).message).toContain('剩余');

    const chat = waitForMessage(room, SERVER_MESSAGES.chatMessage, (payload) =>
      chatMessageSchema.parse(payload),
    );
    await postCommand({
      commandId: randomUUID(),
      type: 'mute',
      accountId: actor.accountId,
      mutedUntil: new Date(Date.now() - 1_000).toISOString(),
      reason: '管理员测试解除禁言',
      issuedAt: new Date().toISOString(),
    });
    room.send('chat.send', {
      protocolVersion: PROTOCOL_VERSION,
      clientMessageId: randomUUID(),
      message: '解除禁言后的消息',
    });
    const message = await chat;
    expect(message.message).toBe('解除禁言后的消息');

    const metrics = (await (await fetch(`${baseUrl}/metrics`)).json()) as {
      totals: { chatMuted: number };
    };
    expect(metrics.totals.chatMuted).toBeGreaterThanOrEqual(1);
  });

  it('kicks every session of a banned account', async () => {
    const actor = await createActor(db, 'AdminBan');
    const room = await joinActor(actor);

    const kicked = waitForMessage(room, SERVER_MESSAGES.sessionKicked, (payload) =>
      sessionKickedSchema.parse(payload),
    );
    const left = waitForLeave(room);

    const response = await postCommand({
      commandId: randomUUID(),
      type: 'ban',
      accountId: actor.accountId,
      reason: '管理员测试封禁',
      issuedAt: new Date().toISOString(),
    });
    expect(adminCommandReceiptSchema.parse(response.body).applied).toBe(1);
    expect((await kicked).kind).toBe('banned');
    await left;
  });

  it('pins content per room and lets new rooms pick up a newer snapshot', async () => {
    const bundleA = JSON.parse(JSON.stringify(BASE_CONTENT_BUNDLE)) as ContentBundle;
    const bundleB = JSON.parse(JSON.stringify(BASE_CONTENT_BUNDLE)) as ContentBundle;
    const slimeA = bundleA.monsters['wild_slime'];
    const slimeB = bundleB.monsters['wild_slime'];
    expect(slimeA).toBeDefined();
    expect(slimeB).toBeDefined();
    if (slimeA === undefined || slimeB === undefined) {
      return;
    }
    slimeA.name = '测试史莱姆·甲';
    slimeB.name = '测试史莱姆·乙';
    let current = {
      version: 'test-content-a',
      checksum: contentChecksum(bundleA),
      bundle: bundleA,
    };
    const provider = {
      snapshot: () => current,
      start: () => Promise.resolve(),
      stop: () => undefined,
    };

    const port = await reservePort();
    const env: GameServerEnv = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      GAME_SERVER_HOST: '127.0.0.1',
      GAME_SERVER_PORT: port,
      DATABASE_URL: requireDatabaseUrl(),
      GAME_SERVER_ID: 'game-server-content-test',
      GAME_SERVER_REALM: 'classic-01',
      INTERNAL_ADMIN_TOKEN: INTERNAL_TOKEN,
    };
    const secondRuntime = createGameServer({
      env,
      logger: logger(),
      database: db,
      contentStore: provider,
      world: { reconnectGraceSeconds: 1, checkpointIntervalMs: 250 },
    });
    await secondRuntime.listen();
    const secondClient = new Client(`http://127.0.0.1:${port}`);

    try {
      const actorA = await createActor(db, 'ContentA', { mapId: STARTER_WILDS_MAP_ID });
      const roomA = (await secondClient.create(
        worldRoomNameFor(STARTER_WILDS_MAP_ID),
        joinOptions(actorA.ticket),
        WorldState,
      )) as WorldRoom;
      await waitUntil(() => roomA.state.monsters.size > 0, 5_000, 'room A monsters');
      expect(roomA.state.contentVersion).toBe('test-content-a');
      expect([...roomA.state.monsters.values()][0]?.displayName).toBe('测试史莱姆·甲');

      current = {
        version: 'test-content-b',
        checksum: contentChecksum(bundleB),
        bundle: bundleB,
      };

      const actorB = await createActor(db, 'ContentB', { mapId: STARTER_WILDS_MAP_ID });
      const roomB = (await secondClient.create(
        worldRoomNameFor(STARTER_WILDS_MAP_ID),
        joinOptions(actorB.ticket),
        WorldState,
      )) as WorldRoom;
      await waitUntil(() => roomB.state.monsters.size > 0, 5_000, 'room B monsters');
      expect(roomB.state.contentVersion).toBe('test-content-b');
      expect([...roomB.state.monsters.values()][0]?.displayName).toBe('测试史莱姆·乙');

      // The first room keeps its creation-time snapshot.
      expect(roomA.state.contentVersion).toBe('test-content-a');
      expect([...roomA.state.monsters.values()][0]?.displayName).toBe('测试史莱姆·甲');

      await roomA.leave();
      await roomB.leave();
    } finally {
      await secondRuntime.shutdown();
    }
  });

  it('refuses a ticket whose account was banned after issue', async () => {
    const actor = await createActor(db, 'AdminBanned');
    await db.update(accounts).set({ status: 'banned' }).where(eq(accounts.id, actor.accountId));

    await expect(createWorld(actor.ticket)).rejects.toThrow();
  });
});
