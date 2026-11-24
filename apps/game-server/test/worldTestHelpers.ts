import { randomUUID } from 'node:crypto';

import { createOpaqueToken, hashToken } from '@web-legend/auth';
import { GAME_TICKET_TTL_SECONDS, TILE_UNITS } from '@web-legend/contracts';
import { PHASE1_TEST_MAP } from '@web-legend/contracts/phase1-map';
import {
  insertAccount,
  insertCharacter,
  insertGameTicket,
  realms,
  type Character,
  type Database,
} from '@web-legend/persistence';

let sequence = 0;

export type TestActor = {
  accountId: string;
  character: Character;
  ticket: string;
};

export async function ensureTestRealm(db: Database): Promise<void> {
  await db
    .insert(realms)
    .values({ code: 'classic-01', name: '经典一区', status: 'active' })
    .onConflictDoNothing({ target: realms.code });
}

function uniqueSuffix(): string {
  sequence += 1;
  return `${randomUUID().replace(/-/gu, '').slice(0, 6)}${sequence.toString(36)}`;
}

async function firstRealmId(db: Database): Promise<string> {
  await ensureTestRealm(db);
  const [realm] = await db.select({ id: realms.id }).from(realms).limit(1);
  if (realm === undefined) {
    throw new Error('no realm available for tests');
  }
  return realm.id;
}

function spawnPosition(): { x: number; y: number } {
  const spawn = PHASE1_TEST_MAP.spawnPoints[0];
  if (spawn === undefined) {
    throw new Error('technical map has no spawn point');
  }
  return { x: spawn.x * TILE_UNITS + TILE_UNITS / 2, y: spawn.y * TILE_UNITS + TILE_UNITS / 2 };
}

export async function issueTicket(
  db: Database,
  actor: Pick<TestActor, 'accountId' | 'character'>,
  ttlSeconds: number = GAME_TICKET_TTL_SECONDS,
): Promise<string> {
  const ticket = createOpaqueToken();
  await insertGameTicket(db, {
    tokenHash: hashToken(ticket),
    accountId: actor.accountId,
    characterId: actor.character.id,
    realmId: actor.character.realmId,
    expiresAt: new Date(Date.now() + ttlSeconds * 1_000),
  });
  return ticket;
}

export type CreateActorOptions = {
  position?: { x: number; y: number };
  facing?: number;
};

/**
 * Provisions a real account, character and game ticket in PostgreSQL. Tests
 * only fake the human behind the browser, never the identity chain itself.
 */
export async function createActor(
  db: Database,
  namePrefix: string,
  options: CreateActorOptions = {},
): Promise<TestActor> {
  const suffix = uniqueSuffix();
  const realmId = await firstRealmId(db);

  const account = await insertAccount(db, {
    username: `test_${suffix}`.slice(0, 24),
    usernameNormalized: `test_${suffix}`.slice(0, 24),
    passwordHash: 'test-only-password-hash',
  });

  const position = options.position ?? spawnPosition();
  const character = await insertCharacter(db, {
    accountId: account.id,
    realmId,
    name: `${namePrefix.slice(0, 4)}${suffix}`.slice(0, 12),
    nameNormalized: `${namePrefix.slice(0, 4)}${suffix}`.slice(0, 12).toLowerCase(),
    classId: 'warrior',
    level: 1,
    exp: 0,
    hp: 120,
    maxHp: 120,
    mp: 30,
    maxMp: 30,
    mapId: PHASE1_TEST_MAP.id,
    x: position.x,
    y: position.y,
    facing: options.facing ?? 2,
  });

  const actor: TestActor = {
    accountId: account.id,
    character,
    ticket: await issueTicket(db, { accountId: account.id, character }),
  };
  return actor;
}
