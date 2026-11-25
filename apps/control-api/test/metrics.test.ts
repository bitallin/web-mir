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
  DATABASE_URL: 'postgres://user:pass@127.0.0.1:1/web_legend',
  CORS_ORIGINS: ['http://localhost:5173'],
  INTERNAL_ADMIN_TOKEN: 'test-internal-admin-token-123',
};

const logger = createLogger({
  service: 'control-api',
  level: 'silent',
  destination: { write: () => undefined },
});

const openServers: Awaited<ReturnType<typeof buildServer>>[] = [];
const openDatabases: DatabaseHandle[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(async (app) => app.close()));
  await Promise.all(openDatabases.splice(0).map(async (database) => database.close()));
});

async function createServer(): Promise<Awaited<ReturnType<typeof buildServer>>> {
  const database = createDatabase(env.DATABASE_URL, { max: 1 });
  const app = await buildServer({
    env,
    logger,
    readiness: () => Promise.resolve([{ name: 'database', status: 'ok' }]),
    database: database.db,
  });
  openServers.push(app);
  openDatabases.push(database);
  return app;
}

describe('control API Prometheus metrics', () => {
  it('exposes HTTP, outbox and runtime series', async () => {
    const app = await createServer();
    await app.inject({ method: 'GET', url: '/health/live' });

    const response = await app.inject({ method: 'GET', url: '/metrics/prometheus' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    const text = response.body;
    expect(text).toContain('# TYPE web_legend_control_api_up gauge');
    expect(text).toContain('# TYPE web_legend_http_requests_total counter');
    // The scrape request itself is in flight while the body is rendered.
    expect(text).toContain('web_legend_http_requests_in_flight 1');
    expect(text).toContain('# TYPE web_legend_http_request_duration_seconds histogram');
    expect(text).toContain('web_legend_outbox_commands{status="pending"}');
    expect(text).toContain('nodejs_event_loop_lag_seconds');
    expect(text).toContain('process_resident_memory_bytes');
    expect(text).toContain('route="/health/live"');
  });

  it('adds security headers to API responses', async () => {
    const app = await createServer();
    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });
});
