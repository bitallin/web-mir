import { sql } from 'drizzle-orm';

import type { Database } from './client';

/** Cheap connectivity probe for readiness endpoints. */
export async function pingDatabase(db: Database): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
