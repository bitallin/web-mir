import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/postgres-js/migrator';

import type { Database } from './client';

/**
 * Resolved relative to this source file. The migration CLI runs from source
 * (`tsx src/migrate.ts`); bundled application code must not run migrations.
 */
export const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

export async function runMigrations(
  db: Database,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): Promise<void> {
  await migrate(db, { migrationsFolder });
}
