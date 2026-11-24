import { loadEnv } from '@web-legend/config';
import { z } from 'zod';

import { createDatabase } from './client';
import { DEFAULT_MIGRATIONS_FOLDER, runMigrations } from './migrator';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

const env = loadEnv(envSchema);
const database = createDatabase(env.DATABASE_URL, { max: 1 });

try {
  await runMigrations(database.db);
  process.stdout.write(`Migrations applied from ${DEFAULT_MIGRATIONS_FOLDER}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? ` (cause: ${error.cause.message})`
      : '';
  process.stderr.write(`Migration failed: ${message}${cause}\n`);
  process.exitCode = 1;
} finally {
  await database.close();
}
