import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema/index';

export type Database = PostgresJsDatabase<typeof schema>;

export type DatabaseHandle = {
  db: Database;
  sql: Sql;
  close: () => Promise<void>;
};

export type CreateDatabaseOptions = {
  max?: number;
};

export function createDatabase(
  connectionString: string,
  options: CreateDatabaseOptions = {},
): DatabaseHandle {
  const sql = postgres(connectionString, {
    max: options.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
  });

  const db = drizzle(sql, { schema });

  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
