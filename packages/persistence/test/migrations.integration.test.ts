import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseHandle } from '../src/client';
import { runMigrations } from '../src/migrator';
import { realms } from '../src/schema/realms';

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL is required for persistence integration tests');
  }
  return url;
}

describe.runIf(process.env.DATABASE_URL !== undefined)('persistence migrations', () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Refusing to run database-mutating tests with NODE_ENV=production');
    }
    handle = createDatabase(requireDatabaseUrl(), { max: 2 });
    await runMigrations(handle.db);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it('is idempotent and creates the realms table', async () => {
    await runMigrations(handle.db);

    const code = `test-${randomUUID()}`;
    const insertedRows = await handle.db
      .insert(realms)
      .values({ code, name: 'Integration Test Realm' })
      .returning();
    const inserted = insertedRows[0];

    if (inserted === undefined) {
      throw new Error('Insert returned no rows');
    }

    expect(inserted.code).toBe(code);
    expect(inserted.status).toBe('active');
    expect(inserted.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/u);

    const found = await handle.db.select().from(realms).where(eq(realms.code, code));
    expect(found).toHaveLength(1);

    await handle.db.delete(realms).where(eq(realms.code, code));
  });

  it('enforces unique realm codes', async () => {
    const code = `dup-${randomUUID()}`;

    await handle.db.insert(realms).values({ code, name: 'First' });
    try {
      await expect(handle.db.insert(realms).values({ code, name: 'Second' })).rejects.toThrow();
    } finally {
      await handle.db.delete(realms).where(eq(realms.code, code));
    }
  });
});
