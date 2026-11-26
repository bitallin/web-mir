import { randomUUID } from 'node:crypto';

import { createOpaqueToken, hashToken } from '@web-legend/auth';
import {
  CHARACTER_CLASS_CATALOG,
  GAME_TICKET_TTL_SECONDS,
  TILE_UNITS,
} from '@web-legend/contracts';
import { STARTER_TOWN_MAP, findMapManifest } from '@web-legend/contracts/maps';
import {
  currencyLedger,
  findRealmByCode,
  insertAccount,
  insertCharacter,
  insertGameTicket,
  realms,
  wallets,
  type Character,
  type Database,
} from '@web-legend/persistence';

let sequence = 0;

export type TestActor = {
  accountId: string;
  character: Character;
  ticket: string;
};

export function tileUnits(tile: { x: number; y: number }): { x: number; y: number } {
  return {
    x: tile.x * TILE_UNITS + TILE_UNITS / 2,
    y: tile.y * TILE_UNITS + TILE_UNITS / 2,
  };
}

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
  // Servers under test bind GAME_SERVER_REALM=classic-01 (ADR-023), so actors
  // must belong to that realm rather than whichever row the database returns.
  const realm = await findRealmByCode(db, 'classic-01');
  if (realm === undefined) {
    throw new Error('no realm available for tests');
  }
  return realm.id;
}

function spawnPosition(mapId: string): { x: number; y: number } {
  const map = findMapManifest(mapId);
  if (map === undefined) {
    throw new Error(`test actor references unknown map "${mapId}"`);
  }
  const spawn = map.spawnPoints[0];
  if (spawn === undefined) {
    throw new Error(`map "${mapId}" has no spawn point`);
  }
  return tileUnits(spawn);
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
  mapId?: string;
  classId?: 'warrior' | 'mage' | 'taoist';
  level?: number;
  /** Progress inside the current level, used by the death-cost tests. */
  exp?: number;
  hp?: number;
  mp?: number;
  gold?: number;
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
  const mapId = options.mapId ?? STARTER_TOWN_MAP.mapId;

  const account = await insertAccount(db, {
    username: `test_${suffix}`.slice(0, 24),
    usernameNormalized: `test_${suffix}`.slice(0, 24),
    passwordHash: 'test-only-password-hash',
  });

  const position = options.position ?? spawnPosition(mapId);
  const classId = options.classId ?? 'warrior';
  const base = CHARACTER_CLASS_CATALOG[classId];
  const character = await insertCharacter(db, {
    accountId: account.id,
    realmId,
    name: `${namePrefix.slice(0, 4)}${suffix}`.slice(0, 12),
    nameNormalized: `${namePrefix.slice(0, 4)}${suffix}`.slice(0, 12).toLowerCase(),
    classId,
    level: options.level ?? 1,
    exp: options.exp ?? 0,
    hp: options.hp ?? base.baseMaxHp,
    maxHp: base.baseMaxHp,
    mp: options.mp ?? base.baseMaxMp,
    maxMp: base.baseMaxMp,
    mapId,
    x: position.x,
    y: position.y,
    facing: options.facing ?? 2,
  });

  if ((options.gold ?? 0) > 0) {
    const gold = options.gold ?? 0;
    await db.insert(wallets).values({ characterId: character.id, balance: gold, version: 1 });
    await db.insert(currencyLedger).values({
      characterId: character.id,
      delta: gold,
      balanceAfter: gold,
      reason: 'test_gold',
      referenceId: character.id,
      idempotencyKey: `test:${character.id}:gold`,
    });
  }

  const actor: TestActor = {
    accountId: account.id,
    character,
    ticket: await issueTicket(db, { accountId: account.id, character }),
  };
  return actor;
}
