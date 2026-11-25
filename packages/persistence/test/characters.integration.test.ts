import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database, type DatabaseHandle } from '../src/client';
import {
  findCharacterById,
  insertAccount,
  insertCharacter,
  saveCharacterCheckpoint,
  saveCharacterTransfer,
} from '../src/repositories/index';
import { characters, realms } from '../src/schema/index';
import { eq } from 'drizzle-orm';

const databaseUrl = process.env.DATABASE_URL;

function requireDatabaseUrl(): string {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required for persistence integration tests');
  }
  return databaseUrl;
}

describe.runIf(databaseUrl !== undefined)('character checkpoints', () => {
  let handle: DatabaseHandle;
  let db: Database;

  beforeAll(async () => {
    handle = createDatabase(requireDatabaseUrl(), { max: 2 });
    db = handle.db;
    await db
      .insert(realms)
      .values({ code: 'classic-01', name: '经典一区', status: 'active' })
      .onConflictDoNothing({ target: realms.code });
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('ignores a checkpoint taken on the map the character already left (TD-DATA-03)', async () => {
    const [realm] = await db.select().from(realms).where(eq(realms.code, 'classic-01')).limit(1);
    if (realm === undefined) {
      throw new Error('test realm missing');
    }
    const suffix = randomUUID().replace(/-/gu, '').slice(0, 8);
    const account = await insertAccount(db, {
      username: `cp_${suffix}`,
      usernameNormalized: `cp_${suffix}`,
      passwordHash: 'test-hash',
    });
    const character = await insertCharacter(db, {
      accountId: account.id,
      realmId: realm.id,
      name: `C${suffix}`.slice(0, 12),
      nameNormalized: `c${suffix}`,
      classId: 'warrior',
      level: 1,
      exp: 0,
      hp: 120,
      maxHp: 120,
      mp: 30,
      maxMp: 30,
      mapId: 'starter_town',
      x: 1_000,
      y: 1_000,
      facing: 2,
    });

    await saveCharacterTransfer(db, {
      characterId: character.id,
      mapId: 'starter_wilds',
      x: 9_000,
      y: 9_000,
      facing: 2,
      hp: 100,
      mp: 20,
    });

    // A checkpoint that started before the transfer committed still carries
    // the old map id and must not drag the character back.
    await saveCharacterCheckpoint(db, {
      characterId: character.id,
      mapId: 'starter_town',
      x: 2_000,
      y: 2_000,
      facing: 1,
      hp: 80,
      mp: 10,
    });

    const afterStale = await findCharacterById(db, character.id);
    expect(afterStale?.mapId).toBe('starter_wilds');
    expect(afterStale?.x).toBe(9_000);
    expect(afterStale?.y).toBe(9_000);
    expect(afterStale?.hp).toBe(100);

    await saveCharacterCheckpoint(db, {
      characterId: character.id,
      mapId: 'starter_wilds',
      x: 9_500,
      y: 9_500,
      facing: 3,
      hp: 90,
      mp: 15,
    });
    const [fresh] = await db.select().from(characters).where(eq(characters.id, character.id));
    expect(fresh?.x).toBe(9_500);
    expect(fresh?.hp).toBe(90);
  });
});
