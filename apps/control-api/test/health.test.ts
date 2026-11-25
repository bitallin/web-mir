import { apiErrorSchema, healthResponseSchema, type ReadinessCheck } from '@web-legend/contracts';
import { createLogger } from '@web-legend/observability';
import { createDatabase, type DatabaseHandle } from '@web-legend/persistence';
import { afterEach, describe, expect, it } from 'vitest';

import type { ControlApiEnv } from '../src/env';
import { buildServer } from '../src/server';

const env: ControlApiEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  CONTROL_API_HOST: '127.0.0.1',
  CONTROL_API_PORT: 3000,
  DATABASE_URL: 'postgres://user:pass@localhost:5432/web_legend',
  CORS_ORIGINS: ['http://localhost:5173'],
  INTERNAL_ADMIN_TOKEN: 'test-internal-admin-token-123',
};

const logger = createLogger({
  service: 'control-api',
  level: 'silent',
  destination: { write: () => undefined },
});

const openServers: Awaited<ReturnType<typeof buildServer>>[] = [];
// Health tests never query the database; the pool connects lazily.
const openDatabases: DatabaseHandle[] = [];

async function createServer(
  checks: ReadinessCheck[] = [{ name: 'database', status: 'ok' }],
): Promise<Awaited<ReturnType<typeof buildServer>>> {
  const database = createDatabase(env.DATABASE_URL, { max: 1 });
  const app = await buildServer({
    env,
    logger,
    readiness: () => Promise.resolve(checks),
    database: database.db,
    startedAt: Date.now() - 1_000,
  });
  openServers.push(app);
  openDatabases.push(database);
  return app;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(async (app) => app.close()));
  await Promise.all(openDatabases.splice(0).map(async (database) => database.close()));
});

describe('control API health routes', () => {
  it('reports liveness', async () => {
    const app = await createServer();
    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    const body: unknown = response.json();
    const parsed = healthResponseSchema.parse(body);
    expect(parsed.status).toBe('ok');
    expect(parsed.service).toBe('control-api');
    expect(parsed.version).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it('reports readiness when checks pass', async () => {
    const app = await createServer();
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      checks: [{ name: 'database', status: 'ok' }],
    });
  });

  it('returns 503 when a readiness check fails', async () => {
    const app = await createServer([
      { name: 'database', status: 'error', detail: 'database unreachable' },
    ]);
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'degraded',
      checks: [{ name: 'database', status: 'error' }],
    });
  });
});

describe('control API error envelope', () => {
  it('returns a canonical 404 body', async () => {
    const app = await createServer();
    const response = await app.inject({ method: 'GET', url: '/missing' });

    expect(response.statusCode).toBe(404);
    const body = apiErrorSchema.parse(response.json());
    expect(body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Route not found' });
    expect(body.error.requestId).toEqual(expect.any(String));
  });

  it('does not leak internal error details', async () => {
    const app = await createServer();
    app.get('/boom', () => {
      throw new Error('SELECT secret FROM vault');
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(response.body).not.toContain('SELECT secret');
  });

  it('allows configured browser origins through CORS', async () => {
    const app = await createServer();
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: 'http://localhost:5173' },
    });

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
