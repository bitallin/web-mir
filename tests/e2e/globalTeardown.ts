import { existsSync } from 'node:fs';

import { dropTestDatabase } from '../../packages/persistence/test/testDatabase';

/**
 * Each browser run owns a throwaway database (ADR-025). Dropping it keeps the
 * next run deterministic and prevents E2E fixtures from accumulating.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_DATABASE === 'true') {
    return;
  }
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  const url = process.env.E2E_DATABASE_URL;
  const name = process.env.E2E_DATABASE_NAME;
  if (url === undefined || url.length === 0 || name === undefined || name.length === 0) {
    return;
  }

  const base = new URL(url);
  base.pathname = '/';
  await dropTestDatabase(base.toString(), name);
}
