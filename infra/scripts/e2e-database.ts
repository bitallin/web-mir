import { existsSync } from 'node:fs';

import {
  createTestDatabase,
  dropTestDatabase,
  testDatabaseBaseUrl,
} from '../../packages/persistence/test/testDatabase';

/**
 * Prepares the dedicated browser-test database (ADR-025). E2E shares neither
 * the development database nor its outbox: the Control API dispatcher for the
 * dev stack would otherwise steal kick rows and deliver them to a room that
 * does not own the session.
 */
const DEFAULT_E2E_DATABASE = 'web_legend_e2e';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

function resolveTarget(): { baseUrl: string; name: string } {
  const explicit = process.env.E2E_DATABASE_URL;
  const name = process.env.E2E_DATABASE_NAME ?? DEFAULT_E2E_DATABASE;
  if (explicit !== undefined && explicit.length > 0) {
    const url = new URL(explicit);
    const databaseName = url.pathname.replace(/^\//u, '');
    url.pathname = '/';
    return {
      baseUrl: url.toString(),
      name: process.env.E2E_DATABASE_NAME ?? databaseName ?? name,
    };
  }

  const baseUrl = testDatabaseBaseUrl();
  if (baseUrl === undefined) {
    throw new Error(
      'E2E needs DATABASE_URL (or TEST_DATABASE_URL / E2E_DATABASE_URL) to create its database',
    );
  }
  return { baseUrl, name };
}

const action = process.argv[2] ?? 'prepare';
const target = resolveTarget();

if (action === 'prepare') {
  await createTestDatabase(target.baseUrl, target.name);
  process.stdout.write(`Prepared E2E database "${target.name}"\n`);
} else if (action === 'drop') {
  await dropTestDatabase(target.baseUrl, target.name);
  process.stdout.write(`Dropped E2E database "${target.name}"\n`);
} else {
  throw new Error(`Unknown action "${action}" (expected prepare or drop)`);
}
