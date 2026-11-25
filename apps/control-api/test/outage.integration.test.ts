import { createServer, connect, type Server, type Socket } from 'node:net';

import { createLogger } from '@web-legend/observability';
import { createDatabase, type DatabaseHandle } from '@web-legend/persistence';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ControlApiEnv } from '../src/env';
import { createDatabaseProbe } from '../src/readiness';
import { buildServer } from '../src/server';

/**
 * Toggles a TCP path to PostgreSQL so the readiness endpoint sees a real
 * outage and a real recovery on the same connection string (ADR-023).
 */
class DatabaseProxy {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();

  constructor(
    readonly port: number,
    private readonly target: { host: string; port: number },
  ) {}

  async start(): Promise<void> {
    const server = createServer((client) => {
      const upstream = connect(this.target);
      this.sockets.add(client);
      this.sockets.add(upstream);
      client.pipe(upstream);
      upstream.pipe(client);
      const destroy = (): void => {
        client.destroy();
        upstream.destroy();
      };
      client.on('error', destroy);
      upstream.on('error', destroy);
      client.on('close', () => {
        this.sockets.delete(client);
        upstream.destroy();
      });
      upstream.on('close', () => {
        this.sockets.delete(upstream);
        client.destroy();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', resolve);
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    const server = this.server;
    this.server = null;
    if (server !== null) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

async function waitForReady(
  app: Awaited<ReturnType<typeof buildServer>>,
  expected: number,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    lastStatus = response.statusCode;
    if (lastStatus === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`readiness did not reach ${String(expected)} (last ${String(lastStatus)})`);
}

describe.runIf(process.env.DATABASE_URL !== undefined)('control API database outage', () => {
  let databaseUrl: string;
  let proxy: DatabaseProxy;
  let database: DatabaseHandle;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    const source = new URL(process.env.DATABASE_URL ?? '');
    const probePort = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        probe.close(() => {
          if (address === null || typeof address === 'string') {
            reject(new Error('failed to reserve a port'));
            return;
          }
          resolve(address.port);
        });
      });
    });
    proxy = new DatabaseProxy(probePort, {
      host: source.hostname,
      port: Number(source.port) || 5432,
    });
    await proxy.start();

    source.hostname = '127.0.0.1';
    source.port = String(probePort);
    databaseUrl = source.toString();

    const env: ControlApiEnv = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      CONTROL_API_HOST: '127.0.0.1',
      CONTROL_API_PORT: 3002,
      DATABASE_URL: databaseUrl,
      CORS_ORIGINS: ['http://localhost:5173'],
      INTERNAL_ADMIN_TOKEN: 'test-internal-admin-token-123',
    };

    database = createDatabase(databaseUrl, { max: 2 });
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
    await proxy?.stop();
  });

  it('reports ready through the database proxy', async () => {
    await waitForReady(app, 200);
  });

  it('returns 503 while the database is unreachable and recovers after it returns', async () => {
    await proxy.stop();
    await waitForReady(app, 503);

    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);

    await proxy.start();
    await waitForReady(app, 200);
  });
});
