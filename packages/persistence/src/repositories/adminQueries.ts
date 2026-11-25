import { and, asc, count, desc, eq, gt, ilike, isNull, lte, or, type SQL } from 'drizzle-orm';

import type { Database } from '../client';
import { accounts } from '../schema/accounts';
import { characters, characterSessions } from '../schema/characters';

export type AdminPlayerFilter = {
  query?: string;
  status?: 'active' | 'banned';
  online?: boolean;
  page: number;
  pageSize: number;
  sortBy: 'name' | 'level' | 'updatedAt';
  sortDir: 'asc' | 'desc';
};

export type AdminPlayerRow = {
  characterId: string;
  name: string;
  classId: 'warrior' | 'mage' | 'taoist';
  level: number;
  mapId: string;
  updatedAt: Date;
  accountId: string;
  username: string;
  accountStatus: 'active' | 'banned';
  mutedUntil: Date | null;
  gameServerId: string | null;
  leaseExpiresAt: Date | null;
};

export type AdminPlayerPage = {
  items: AdminPlayerRow[];
  total: number;
};

function playerConditions(filter: AdminPlayerFilter, now: Date): SQL[] {
  const conditions: SQL[] = [];
  if (filter.query !== undefined && filter.query.length > 0) {
    const pattern = `%${filter.query}%`;
    const queryClause = or(ilike(characters.name, pattern), ilike(accounts.username, pattern));
    if (queryClause !== undefined) {
      conditions.push(queryClause);
    }
  }
  if (filter.status !== undefined) {
    conditions.push(eq(accounts.status, filter.status));
  }
  if (filter.online === true) {
    conditions.push(gt(characterSessions.leaseExpiresAt, now));
  } else if (filter.online === false) {
    const offline = or(
      isNull(characterSessions.leaseExpiresAt),
      lte(characterSessions.leaseExpiresAt, now),
    );
    if (offline !== undefined) {
      conditions.push(offline);
    }
  }
  return conditions;
}

export async function listAdminPlayers(
  db: Database,
  filter: AdminPlayerFilter,
  now: Date,
): Promise<AdminPlayerPage> {
  const conditions = playerConditions(filter, now);
  const where = conditions.length === 0 ? undefined : and(...conditions);

  const sortColumn =
    filter.sortBy === 'level'
      ? characters.level
      : filter.sortBy === 'name'
        ? characters.name
        : characters.updatedAt;
  const order = filter.sortDir === 'asc' ? asc(sortColumn) : desc(sortColumn);

  const [rows, totals] = await Promise.all([
    db
      .select({
        characterId: characters.id,
        name: characters.name,
        classId: characters.classId,
        level: characters.level,
        mapId: characters.mapId,
        updatedAt: characters.updatedAt,
        accountId: accounts.id,
        username: accounts.username,
        accountStatus: accounts.status,
        mutedUntil: accounts.mutedUntil,
        gameServerId: characterSessions.gameServerId,
        leaseExpiresAt: characterSessions.leaseExpiresAt,
      })
      .from(characters)
      .innerJoin(accounts, eq(characters.accountId, accounts.id))
      .leftJoin(characterSessions, eq(characterSessions.characterId, characters.id))
      .where(where)
      .orderBy(order, asc(characters.id))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize),
    db
      .select({ total: count() })
      .from(characters)
      .innerJoin(accounts, eq(characters.accountId, accounts.id))
      .leftJoin(characterSessions, eq(characterSessions.characterId, characters.id))
      .where(where),
  ]);

  return { items: rows, total: totals[0]?.total ?? 0 };
}

export type AdminPlayerRecord = {
  character: typeof characters.$inferSelect;
  account: typeof accounts.$inferSelect;
  gameServerId: string | null;
  leaseExpiresAt: Date | null;
};

export async function findAdminPlayer(
  db: Database,
  characterId: string,
): Promise<AdminPlayerRecord | undefined> {
  const [row] = await db
    .select({
      character: characters,
      account: accounts,
      gameServerId: characterSessions.gameServerId,
      leaseExpiresAt: characterSessions.leaseExpiresAt,
    })
    .from(characters)
    .innerJoin(accounts, eq(characters.accountId, accounts.id))
    .leftJoin(characterSessions, eq(characterSessions.characterId, characters.id))
    .where(eq(characters.id, characterId))
    .limit(1);
  return row;
}

export type DashboardCounts = {
  accounts: number;
  characters: number;
  onlinePlayers: number;
};

export async function dashboardCounts(db: Database, now: Date): Promise<DashboardCounts> {
  const [accountRows, characterRows, onlineRows] = await Promise.all([
    db.select({ total: count() }).from(accounts),
    db.select({ total: count() }).from(characters),
    db
      .select({ total: count() })
      .from(characterSessions)
      .where(gt(characterSessions.leaseExpiresAt, now)),
  ]);
  return {
    accounts: accountRows[0]?.total ?? 0,
    characters: characterRows[0]?.total ?? 0,
    onlinePlayers: onlineRows[0]?.total ?? 0,
  };
}
