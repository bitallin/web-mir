import { loadEnv } from '@web-legend/config';
import { z } from 'zod';

import { createDatabase } from './client';
import { realms } from './schema/index';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

/**
 * Idempotent local/dev seed. Production realms are managed explicitly, not by
 * running this script.
 */
const DEFAULT_REALMS = [{ code: 'classic-01', name: '经典一区', status: 'active' }] as const;

const env = loadEnv(envSchema);
const database = createDatabase(env.DATABASE_URL, { max: 1 });

try {
  for (const realm of DEFAULT_REALMS) {
    await database.db.insert(realms).values(realm).onConflictDoNothing({ target: realms.code });
  }
  process.stdout.write(`Seeded ${String(DEFAULT_REALMS.length)} realm(s)\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Seed failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  await database.close();
}
