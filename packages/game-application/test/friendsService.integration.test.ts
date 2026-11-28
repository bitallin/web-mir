import { randomUUID } from 'node:crypto';

import {
  createDatabase,
  insertAccount,
  insertCharacter,
  realms,
  type CharacterClassId,
  type Database,
  type DatabaseHandle,
} from '@web-legend/persistence';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FriendsService } from '../src/index';

const databaseUrl = process.env.DATABASE_URL;
const REALM_CODE = 'classic-01';
const PASSWORD_HASH = 'friends-test-hash';

function requireDatabaseUrl(): string {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required for friend application integration tests');
  }
  return databaseUrl;
}

let sequence = 0;

function suffix(): string {
  sequence += 1;
  return `${randomUUID().replace(/-/gu, '').slice(0, 6)}${sequence.toString(36)}`;
}

async function createCharacter(db: Database, classId: CharacterClassId = 'warrior') {
  const [realm] = await db.select().from(realms).where(eq(realms.code, REALM_CODE)).limit(1);
  if (realm === undefined) {
    throw new Error('test realm is missing');
  }
  const token = suffix();
  const account = await insertAccount(db, {
    username: `friend_${token}`.slice(0, 24),
    usernameNormalized: `friend_${token}`.slice(0, 24),
    passwordHash: PASSWORD_HASH,
  });
  const character = await insertCharacter(db, {
    accountId: account.id,
    realmId: realm.id,
    name: `F${token}`.slice(0, 12),
    nameNormalized: `f${token}`.slice(0, 12).toLowerCase(),
    classId,
    level: 3,
    exp: 0,
    hp: 100,
    maxHp: 100,
    mp: 30,
    maxMp: 30,
    mapId: 'starter_wilds',
    x: 7_500,
    y: 15_500,
    facing: 2,
  });
  return character;
}

async function expectSocialError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'SocialError', code });
}

describe.runIf(databaseUrl !== undefined)('FriendsService with PostgreSQL', () => {
  let handle: DatabaseHandle;
  let db: Database;
  let service: FriendsService;

  beforeAll(async () => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to run database-mutating tests with NODE_ENV=production');
    }
    handle = createDatabase(requireDatabaseUrl(), { max: 5 });
    db = handle.db;
    await db
      .insert(realms)
      .values({ code: REALM_CODE, name: '经典一区', status: 'active' })
      .onConflictDoNothing({ target: realms.code });
    service = new FriendsService(db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('turns a pending request into a mutual friendship that both sides can list', async () => {
    const alice = await createCharacter(db);
    const bob = await createCharacter(db);

    const requested = await service.request(alice.id, bob.id);
    expect(requested.autoAccepted).toBe(false);

    const aliceView = await service.relations(alice.id);
    expect(aliceView.friends).toEqual([]);
    expect(aliceView.outgoing.map((row) => row.playerId)).toEqual([bob.id]);
    expect(aliceView.incoming).toEqual([]);

    const bobView = await service.relations(bob.id);
    expect(bobView.incoming.map((row) => row.requestId)).toEqual([requested.requestId]);
    expect(bobView.outgoing).toEqual([]);
    expect(bobView.incoming[0]?.displayName).toBe(alice.name);

    const accepted = await service.accept(bob.id, requested.requestId);
    expect(accepted.requesterId).toBe(alice.id);
    expect(await service.areFriends(alice.id, bob.id)).toBe(true);
    expect((await service.relations(alice.id)).friends.map((row) => row.playerId)).toEqual([
      bob.id,
    ]);
    expect((await service.relations(bob.id)).friends.map((row) => row.playerId)).toEqual([
      alice.id,
    ]);
    expect(await service.friendIds(bob.id)).toEqual([alice.id]);

    // A repeated accept is harmless and still reports the same pair.
    const again = await service.accept(bob.id, requested.requestId);
    expect(again.requesterId).toBe(alice.id);
    expect((await service.relations(bob.id)).friends).toHaveLength(1);

    await service.remove(alice.id, bob.id);
    expect(await service.areFriends(alice.id, bob.id)).toBe(false);
    expect((await service.relations(alice.id)).friends).toEqual([]);
    // Removing an absent relation is a no-op.
    expect(await service.remove(alice.id, bob.id)).toBe(false);
  });

  it('converges duplicate requests and auto-accepts a mutual request', async () => {
    const alice = await createCharacter(db);
    const bob = await createCharacter(db);

    const first = await service.request(alice.id, bob.id);
    const duplicate = await service.request(alice.id, bob.id);
    expect(duplicate.requestId).toBe(first.requestId);
    expect((await service.relations(bob.id)).incoming).toHaveLength(1);

    // Asking back accepts the request that was already waiting.
    const back = await service.request(bob.id, alice.id);
    expect(back.autoAccepted).toBe(true);
    expect(await service.areFriends(alice.id, bob.id)).toBe(true);
  });

  it('rejects invalid requests and non-participant accepts', async () => {
    const alice = await createCharacter(db);
    const bob = await createCharacter(db);
    const stranger = await createCharacter(db);

    await expectSocialError(service.request(alice.id, alice.id), 'FRIEND_SELF');
    await expectSocialError(
      service.request(alice.id, '018f0f3e-6a6f-7c4a-9b3e-3f1f2b7c9d99'),
      'FRIEND_TARGET_NOT_FOUND',
    );

    const request = await service.request(alice.id, bob.id);
    await expectSocialError(
      service.accept(stranger.id, request.requestId),
      'FRIEND_REQUEST_NOT_FOUND',
    );
    await expectSocialError(
      service.accept(alice.id, request.requestId),
      'FRIEND_REQUEST_NOT_FOUND',
    );

    // Declining removes the pending row, so either side may ask again later.
    const declined = await service.decline(bob.id, request.requestId);
    expect(declined.requesterId).toBe(alice.id);
    expect((await service.relations(bob.id)).incoming).toEqual([]);
    await expectSocialError(service.decline(bob.id, request.requestId), 'FRIEND_REQUEST_NOT_FOUND');
    expect((await service.request(alice.id, bob.id)).autoAccepted).toBe(false);
  });

  it('reports an existing friendship instead of creating another request', async () => {
    const alice = await createCharacter(db);
    const bob = await createCharacter(db);
    const request = await service.request(alice.id, bob.id);
    await service.accept(bob.id, request.requestId);

    await expectSocialError(service.request(alice.id, bob.id), 'FRIEND_ALREADY_FRIENDS');
    // Removing is the only way to start over.
    await service.remove(alice.id, bob.id);
    const again = await service.request(alice.id, bob.id);
    expect(again.autoAccepted).toBe(false);
  });
});
