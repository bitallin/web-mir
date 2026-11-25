import { sql } from 'drizzle-orm';

import type { Database } from './client';

const PROBE_TIMEOUT_MS = 2_000;

/** Cheap connectivity probe for readiness endpoints. */
export async function pingDatabase(db: Database): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    // A black-holed database accepts the connection but never answers; the
    // timeout keeps /health/ready from hanging during an outage.
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
