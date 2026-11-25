import {
  STALE_DATABASE_MS,
  createTestDatabase,
  dropStaleTestDatabases,
  dropTestDatabase,
  testDatabaseBaseUrl,
} from './testDatabase';

let active: { baseUrl: string; name: string } | undefined;

/**
 * Vitest global setup (ADR-024): the database name and scoped URL are prepared
 * by vitest.config.ts; this hook only performs the DDL and teardown.
 *
 * Exported as named `setup`/`teardown`: Vitest ignores a named `teardown` when
 * the module also has a default export, which silently leaked databases.
 */
export async function setup(): Promise<void> {
  const baseUrl = testDatabaseBaseUrl();
  const name = process.env.VITEST_TEST_DATABASE;
  if (baseUrl === undefined || name === undefined || name.length === 0) {
    return;
  }

  // Set TEST_DATABASE_STALE_MS=0 for a one-off cleanup after an interrupted
  // run; the default only removes databases left for a day.
  const staleAfter = Number(process.env.TEST_DATABASE_STALE_MS ?? STALE_DATABASE_MS);
  await dropStaleTestDatabases(
    baseUrl,
    Number.isFinite(staleAfter) && staleAfter >= 0 ? staleAfter : STALE_DATABASE_MS,
  );
  await createTestDatabase(baseUrl, name);
  active = { baseUrl, name };
}

export async function teardown(): Promise<void> {
  if (active === undefined) {
    return;
  }
  const current = active;
  active = undefined;
  await dropTestDatabase(current.baseUrl, current.name);
}
