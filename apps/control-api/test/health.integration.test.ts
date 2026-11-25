import { createLogger } from '@web-legend/observability';
import { createDatabase, type DatabaseHandle } from '@web-legend/persistence';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ControlApiEnv } from '../src/env';
import { createDatabaseProbe } from '../src/readiness';
import { buildServer } from '../src/server';

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL is required for control API integration tests');
  }
  return url;
}

describe.runIf(process.env.DATABASE_URL !== undefined)('control API database readiness', () => {
  let database: DatabaseHandle;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    const env: ControlApiEnv = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      CONTROL_API_HOST: '127.0.0.1',
      CONTROL_API_PORT: 3001,
      DATABASE_URL: requireDatabaseUrl(),
      CORS_ORIGINS: ['http://localhost:5173'],
      INTERNAL_ADMIN_TOKEN: 'test-internal-admin-token-123',
    };

    database = createDatabase(env.DATABASE_URL, { max: 1 });
    app = await buildServer({
      env,
      logger: createLogger({
        service: 'control-api',
        level: 'silent',
        destination: { write: () => undefined },
      }),
      readiness: createDatabaseProbe(database.db),
      database: database.db,
    });
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  it('reports the live database as ready', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      checks: [{ name: 'database', status: 'ok' }],
    });
  });
});
