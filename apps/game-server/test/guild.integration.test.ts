import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import {
  PROTOCOL_VERSION,
  STARTER_TOWN_MAP_ID,
  STARTER_WILDS_MAP_ID,
  chatMessageSchema,
  commandRejectedSchema,
  guildInviteViewSchema,
  guildSnapshotSchema,
  systemNoticeSchema,
  worldRoomNameFor,
  type ChatMessage,
  type CommandRejected,
  type GuildInviteView,
  type GuildSnapshot,
  type SystemNotice,
} from '@web-legend/contracts';
import { WorldState, type WorldStateInstance } from '@web-legend/contracts/world-state';
import { createLogger } from '@web-legend/observability';
import {
  createDatabase,
  guildMembers,
  type Database,
  type DatabaseHandle,
} from '@web-legend/persistence';
import { asc, eq } from 'drizzle-orm';
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

function waitForGuildSnapshot(
  room: SdkRoom,
  predicate: (snapshot: GuildSnapshot) => boolean,
  timeoutMs = 5_000,
): Promise<GuildSnapshot> {
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for a matching guild snapshot'));
    }, timeoutMs);
    unsubscribe = room.onMessage('guild.snapshot', (payload: unknown) => {
      const parsed = guildSnapshotSchema.parse(payload);
      if (!predicate(parsed)) {
        return;
      }
      clearTimeout(timer);
      unsubscribe();
      resolve(parsed);
    });
  });
}

function waitForSystemNotice(
  room: SdkRoom,
  predicate: (notice: SystemNotice) => boolean,
  timeoutMs = 5_000,
): Promise<SystemNotice> {
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for a matching system notice'));
    }, timeoutMs);
    unsubscribe = room.onMessage('system.notice', (payload: unknown) => {
      const parsed = systemNoticeSchema.parse(payload);
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

describe.runIf(databaseUrl !== undefined)('world_map guilds', () => {
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

  async function createMapRoom(mapId: string, ticket: string): Promise<WorldRoom> {
    const room = (await client().create(
      worldRoomNameFor(mapId),
      joinOptions(ticket),
      WorldState,
    )) as WorldRoom;
    cleanups.push(async () => {
      await room.leave();
    });
    return room;
  }

  function createTown(ticket: string): Promise<WorldRoom> {
    return createMapRoom(STARTER_TOWN_MAP_ID, ticket);
  }

  function createWilds(ticket: string): Promise<WorldRoom> {
    return createMapRoom(STARTER_WILDS_MAP_ID, ticket);
  }

  async function actorInTown(
    position: { x: number; y: number },
    options: CreateActorOptions = {},
  ): Promise<TestActor> {
    return createActor(db, 'Guild', {
      mapId: STARTER_TOWN_MAP_ID,
      position: tileUnits(position),
      level: 6,
      ...options,
    });
  }

  async function actorInWilds(
    position: { x: number; y: number },
    options: CreateActorOptions = {},
  ): Promise<TestActor> {
    return createActor(db, 'Guild', {
      mapId: STARTER_WILDS_MAP_ID,
      position: tileUnits(position),
      level: 6,
      ...options,
    });
  }

  async function createGuild(room: WorldRoom, actor: TestActor, name: string): Promise<void> {
    const created = waitForGuildSnapshot(
      room,
      (snapshot) => snapshot.guild !== null && snapshot.guild.name === name,
    );
    room.send('guild.create', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      name,
    });
    const snapshot = await created;
    expect(snapshot.guild?.leaderId).toBe(actor.character.id);
    expect(snapshot.guild?.members[0]?.leader).toBe(true);
  }

  async function inviteAndAccept(
    leaderRoom: WorldRoom,
    memberRoom: WorldRoom,
    leader: TestActor,
    member: TestActor,
  ): Promise<GuildInviteView> {
    const invitePromise = waitForMessage<GuildInviteView>(memberRoom, 'guild.invite', (payload) =>
      guildInviteViewSchema.parse(payload),
    );
    leaderRoom.send('guild.invite', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      targetPlayerId: member.character.id,
    });
    const invite = await invitePromise;
    expect(invite.fromPlayerId).toBe(leader.character.id);

    const memberJoined = waitForGuildSnapshot(
      memberRoom,
      (snapshot) => snapshot.guild?.members.length === 2,
    );
    const leaderRefreshed = waitForGuildSnapshot(
      leaderRoom,
      (snapshot) => snapshot.guild?.members.length === 2,
    );
    memberRoom.send('guild.accept', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      inviteId: invite.inviteId,
    });
    const [snapshot] = await Promise.all([memberJoined, leaderRefreshed]);
    expect(snapshot.guild?.leaderId).toBe(leader.character.id);
    expect(snapshot.guild?.members.map((row) => row.playerId).sort()).toEqual(
      [leader.character.id, member.character.id].sort(),
    );
    return invite;
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
      GAME_SERVER_ID: 'game-server-guild-test',
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

  it('creates a guild, persists its leader and rejects a duplicate name', async () => {
    const leader = await actorInTown(SAFE_TILE);
    const room = await createTown(leader.ticket);
    await waitUntil(
      () => room.state.players.has(leader.character.id),
      10_000,
      'guild leader joined',
    );

    const name = `黎明${randomUUID().slice(0, 4)}`;
    await createGuild(room, leader, name);

    const rows = await db
      .select()
      .from(guildMembers)
      .where(eq(guildMembers.characterId, leader.character.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('leader');

    const other = await actorInTown({ x: 3, y: 16 });
    const otherRoom = await createTown(other.ticket);
    await waitUntil(() => otherRoom.state.players.has(other.character.id), 10_000, 'second joined');
    const rejection = waitForMessage<CommandRejected>(otherRoom, 'command.rejected', (payload) =>
      commandRejectedSchema.parse(payload),
    );
    otherRoom.send('guild.create', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      name,
    });
    expect((await rejection).code).toBe('GUILD_NAME_TAKEN');
  });

  it('invites across maps, accepts, and chats with only online members', async () => {
    const leader = await actorInTown(SAFE_TILE);
    const member = await actorInWilds({ x: 2, y: 16 });
    const outsider = await actorInTown({ x: 3, y: 16 });
    const leaderRoom = await createTown(leader.ticket);
    await waitUntil(
      () => leaderRoom.state.players.has(leader.character.id),
      10_000,
      'leader joined',
    );
    const memberRoom = await createWilds(member.ticket);
    await waitUntil(
      () => memberRoom.state.players.has(member.character.id),
      10_000,
      'member joined',
    );
    const outsiderRoom = await createTown(outsider.ticket);
    await waitUntil(
      () => outsiderRoom.state.players.has(outsider.character.id),
      10_000,
      'outsider joined',
    );

    await createGuild(leaderRoom, leader, `跨图${randomUUID().slice(0, 4)}`);
    await inviteAndAccept(leaderRoom, memberRoom, leader, member);

    // inviteAndAccept already waited for the leader's refreshed roster; read
    // the fresh snapshot once more to assert the cross-map presence it carries.
    const leaderRoster = waitForGuildSnapshot(
      leaderRoom,
      (snapshot) => snapshot.guild?.members.length === 2,
    );
    leaderRoom.send('guild.list', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
    });
    const roster = await leaderRoster;
    const memberRow = roster.guild?.members.find((row) => row.playerId === member.character.id);
    expect(memberRow?.online).toBe(true);

    // Guild chat reaches the member on another map, and the member can answer.
    const memberChat = waitForMessage<ChatMessage>(memberRoom, 'chat.message', (payload) =>
      chatMessageSchema.parse(payload),
    );
    leaderRoom.send('chat.send', {
      protocolVersion: PROTOCOL_VERSION,
      clientMessageId: randomUUID(),
      channel: 'guild',
      message: '集合，去废墟',
    });
    const heard = await memberChat;
    expect(heard.channel).toBe('guild');
    expect(heard.playerId).toBe(leader.character.id);

    const leaderChat = waitForMessage<ChatMessage>(leaderRoom, 'chat.message', (payload) =>
      chatMessageSchema.parse(payload),
    );
    memberRoom.send('chat.send', {
      protocolVersion: PROTOCOL_VERSION,
      clientMessageId: randomUUID(),
      channel: 'guild',
      message: '马上到',
    });
    expect((await leaderChat).playerId).toBe(member.character.id);

    // Someone outside the guild gets a rejection and no guild chat echo.
    const outsiderRejection = waitForMessage<CommandRejected>(
      outsiderRoom,
      'command.rejected',
      (payload) => commandRejectedSchema.parse(payload),
    );
    outsiderRoom.send('chat.send', {
      protocolVersion: PROTOCOL_VERSION,
      clientMessageId: randomUUID(),
      channel: 'guild',
      message: '我也在吗',
    });
    expect((await outsiderRejection).code).toBe('GUILD_NOT_IN_GUILD');
  });

  it('rejects invites from members and targets that already belong to a guild', async () => {
    const leader = await actorInTown(SAFE_TILE);
    const member = await actorInTown({ x: 3, y: 16 });
    const outsider = await actorInTown({ x: 4, y: 16 });
    const leaderRoom = await createTown(leader.ticket);
    await waitUntil(
      () => leaderRoom.state.players.has(leader.character.id),
      10_000,
      'leader joined',
    );
    const memberRoom = await createTown(member.ticket);
    await waitUntil(
      () => memberRoom.state.players.has(member.character.id),
      10_000,
      'member joined',
    );
    const outsiderRoom = await createTown(outsider.ticket);
    await waitUntil(
      () => outsiderRoom.state.players.has(outsider.character.id),
      10_000,
      'outsider joined',
    );

    await createGuild(leaderRoom, leader, `权限${randomUUID().slice(0, 4)}`);
    await inviteAndAccept(leaderRoom, memberRoom, leader, member);

    const notLeader = waitForMessage<CommandRejected>(memberRoom, 'command.rejected', (payload) =>
      commandRejectedSchema.parse(payload),
    );
    memberRoom.send('guild.invite', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      targetPlayerId: outsider.character.id,
    });
    expect((await notLeader).code).toBe('GUILD_NOT_LEADER');

    const alreadyMember = waitForMessage<CommandRejected>(
      leaderRoom,
      'command.rejected',
      (payload) => commandRejectedSchema.parse(payload),
    );
    leaderRoom.send('guild.invite', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      targetPlayerId: member.character.id,
    });
    expect((await alreadyMember).code).toBe('GUILD_TARGET_IN_GUILD');
  });

  it('kicks, transfers leadership on leave, and clears the roster on disband', async () => {
    const leader = await actorInTown(SAFE_TILE);
    const member = await actorInTown({ x: 3, y: 16 });
    const leaderRoom = await createTown(leader.ticket);
    await waitUntil(
      () => leaderRoom.state.players.has(leader.character.id),
      10_000,
      'leader joined',
    );
    const memberRoom = await createTown(member.ticket);
    await waitUntil(
      () => memberRoom.state.players.has(member.character.id),
      10_000,
      'member joined',
    );

    await createGuild(leaderRoom, leader, `收口${randomUUID().slice(0, 4)}`);
    await inviteAndAccept(leaderRoom, memberRoom, leader, member);

    const kicked = waitForGuildSnapshot(memberRoom, (snapshot) => snapshot.guild === null);
    const kickedNotice = waitForSystemNotice(memberRoom, (notice) =>
      notice.message.includes('移出行会'),
    );
    leaderRoom.send('guild.kick', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
      targetPlayerId: member.character.id,
    });
    expect((await kicked).guild).toBeNull();
    expect((await kickedNotice).message).toContain('移出行会');

    await inviteAndAccept(leaderRoom, memberRoom, leader, member);

    const memberBecomesLeader = waitForGuildSnapshot(
      memberRoom,
      (snapshot) =>
        snapshot.guild?.leaderId === member.character.id &&
        snapshot.guild.members.some((row) => row.playerId === member.character.id && row.leader),
    );
    leaderRoom.send('guild.leave', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
    });
    expect((await memberBecomesLeader).guild?.members).toHaveLength(1);

    const disbanded = waitForGuildSnapshot(memberRoom, (snapshot) => snapshot.guild === null);
    memberRoom.send('guild.disband', {
      protocolVersion: PROTOCOL_VERSION,
      commandId: randomUUID(),
      clientSequence: nextSequence(),
    });
    expect((await disbanded).guild).toBeNull();

    const remaining = await db
      .select()
      .from(guildMembers)
      .where(eq(guildMembers.characterId, member.character.id))
      .orderBy(asc(guildMembers.joinedAt));
    expect(remaining).toEqual([]);
  });
});
