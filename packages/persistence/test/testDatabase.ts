import postgres from 'postgres';

import { createDatabase } from '../src/client';
import { DEFAULT_MIGRATIONS_FOLDER, runMigrations } from '../src/migrator';
import {
  STALE_DATABASE_MS,
  TEST_DATABASE_PREFIX,
  testDatabaseUrl,
  timestampFromDatabaseName,
} from './testDatabaseNaming';

/**
 * Per-run PostgreSQL database for `pnpm test` (ADR-024). Drizzle migrations
 * schema-qualify their DDL with "public", so a schema inside the development
 * database cannot isolate them; a throwaway database can. TEST_DATABASE_URL
 * can point the base connection at a dedicated instance.
 */
export {
  STALE_DATABASE_MS,
  TEST_DATABASE_PREFIX,
  testDatabaseBaseUrl,
  testDatabaseName,
  testDatabaseUrl,
} from './testDatabaseNaming';

function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to create or drop a test database with NODE_ENV=production');
  }
}

/**
 * Best-effort cleanup for databases left behind when a previous run was
 * killed. Active runs have fresh timestamps and are never touched.
 */
export async function dropStaleTestDatabases(
  baseUrl: string,
  olderThanMs = STALE_DATABASE_MS,
  now = Date.now(),
): Promise<string[]> {
  assertNotProduction();
  const sql = postgres(baseUrl, { max: 1, onnotice: () => undefined });
  const dropped: string[] = [];
  try {
    const rows = await sql<{ datname: string }[]>`
      select datname
      from pg_database
      where datname like ${`${TEST_DATABASE_PREFIX}%`}
    `;
    for (const row of rows) {
      const createdAt = timestampFromDatabaseName(row.datname);
      if (createdAt === undefined || now - createdAt < olderThanMs) {
        continue;
      }
      await sql`drop database if exists ${sql.identifier(row.datname)} with (force)`;
      dropped.push(row.datname);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  return dropped;
}

export async function createTestDatabase(baseUrl: string, name: string): Promise<void> {
  assertNotProduction();
  const maintenance = postgres(baseUrl, { max: 1, onnotice: () => undefined });
  try {
    await maintenance`drop database if exists ${maintenance.identifier(name)} with (force)`;
    try {
      await maintenance`create database ${maintenance.identifier(name)}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not create the test database "${name}" (${message}). ` +
          'The database role needs CREATEDB, or set TEST_DATABASE_URL to an instance where it does.',
        { cause: error },
      );
    }
  } finally {
    await maintenance.end({ timeout: 5 });
  }

  const handle = createDatabase(testDatabaseUrl(baseUrl, name), { max: 1 });
  try {
    await runMigrations(handle.db, DEFAULT_MIGRATIONS_FOLDER);
  } finally {
    await handle.close();
  }
}

export async function dropTestDatabase(baseUrl: string, name: string): Promise<void> {
  assertNotProduction();
  const maintenance = postgres(baseUrl, { max: 1, onnotice: () => undefined });
  try {
    await maintenance`drop database if exists ${maintenance.identifier(name)} with (force)`;
  } finally {
    await maintenance.end({ timeout: 5 });
  }
}
