import { describe, expect, it } from 'vitest';

import { createDatabase } from '../src/client';
import { TEST_DATABASE_PREFIX, testDatabaseName, testDatabaseUrl } from './testDatabase';

const databaseUrl = process.env.DATABASE_URL;

function requireDatabaseUrl(): string {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required for the test database check');
  }
  return databaseUrl;
}

describe('test database naming', () => {
  it('creates a prefixed name with a sortable base36 timestamp', () => {
    const name = testDatabaseName(1_800_000_000_000);

    expect(name.startsWith(`${TEST_DATABASE_PREFIX}${(1_800_000_000_000).toString(36)}_`)).toBe(
      true,
    );
    expect(name).not.toBe(testDatabaseName(1_800_000_000_000));
  });

  it('scopes a connection URL to the database without losing connection details', () => {
    const url = new URL(testDatabaseUrl('postgres://user:pass@db.local:5432/web_legend', 'wl_x'));

    expect(url.pathname).toBe('/wl_x');
    expect(url.hostname).toBe('db.local');
    expect(url.username).toBe('user');
  });
});

describe.runIf(databaseUrl !== undefined)('per-run database', () => {
  it('runs the suite in the isolated database with migrated tables', async () => {
    const name = process.env.VITEST_TEST_DATABASE;
    expect(name).toBeDefined();
    if (name === undefined) {
      return;
    }

    const handle = createDatabase(requireDatabaseUrl(), { max: 1 });
    try {
      const current = await handle.sql<{ database: string | null }[]>`
        select current_database() as database
      `;
      expect(current[0]?.database).toBe(name);

      const tables = await handle.sql<{ count: string }[]>`
        select count(*)::text as count
        from information_schema.tables
        where table_schema = 'public'
      `;
      expect(Number(tables[0]?.count)).toBeGreaterThan(10);

      const migrations = await handle.sql<{ count: string }[]>`
        select count(*)::text as count from drizzle.__drizzle_migrations
      `;
      expect(Number(migrations[0]?.count)).toBeGreaterThan(0);
    } finally {
      await handle.close();
    }
  });
});
