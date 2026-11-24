import { asc, eq } from 'drizzle-orm';

import type { Database } from '../client';
import { realms, type Realm } from '../schema/index';

export async function listActiveRealms(db: Database): Promise<Realm[]> {
  return db.select().from(realms).where(eq(realms.status, 'active')).orderBy(asc(realms.code));
}

export async function findRealmById(db: Database, id: string): Promise<Realm | undefined> {
  const [realm] = await db.select().from(realms).where(eq(realms.id, id)).limit(1);
  return realm;
}
