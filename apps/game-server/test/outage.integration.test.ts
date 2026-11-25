import { get } from 'node:http';
import { createServer, connect, type Server, type Socket } from 'node:net';

import { createLogger } from '@web-legend/observability';
import { createDatabase, type DatabaseHandle } from '@web-legend/persistence';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { GameServerEnv } from '../src/env';
import { createGameServer, type GameServerRuntime } from '../src/server';

/** Toggles a real TCP path to PostgreSQL to exercise an outage (ADR-023). */
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

function reservePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        if (address === null || typeof address === 'string') {
          reject(new Error('failed to reserve a port'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function readyStatus(port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request = get(`http://127.0.0.1:${String(port)}/health/ready`, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on('error', reject);
    request.setTimeout(5_000, () => {
      request.destroy();
      reject(new Error('readiness request timed out'));
    });
  });
}

async function waitForReady(port: number, expected: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    lastStatus = await readyStatus(port);
    if (lastStatus === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`readiness did not reach ${String(expected)} (last ${String(lastStatus)})`);
}

describe.runIf(process.env.DATABASE_URL !== undefined)('game server database outage', () => {
  let runtime: GameServerRuntime;
  let proxy: DatabaseProxy;
  let database: DatabaseHandle;
  let port: number;

  beforeAll(async () => {
    const source = new URL(process.env.DATABASE_URL ?? '');
    const proxyPort = await reservePort();
    proxy = new DatabaseProxy(proxyPort, {
      host: source.hostname,
      port: Number(source.port) || 5432,
    });
    await proxy.start();

    source.hostname = '127.0.0.1';
    source.port = String(proxyPort);
    port = await reservePort();

    const env: GameServerEnv = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      GAME_SERVER_HOST: '127.0.0.1',
      GAME_SERVER_PORT: port,
      DATABASE_URL: source.toString(),
      GAME_SERVER_ID: 'game-server-outage-test',
      GAME_SERVER_REALM: 'classic-01',
      INTERNAL_ADMIN_TOKEN: 'test-internal-admin-token-123',
    };

    database = createDatabase(env.DATABASE_URL, { max: 2 });
    runtime = createGameServer({
      env,
      logger: createLogger({
        service: 'game-server',
        level: 'silent',
        destination: { write: () => undefined },
      }),
      database: database.db,
    });
    await runtime.listen();
  });

  afterAll(async () => {
    await runtime?.shutdown();
    await database?.close();
    await proxy?.stop();
  });

  it('reports ready through the database proxy', async () => {
    await waitForReady(port, 200);
  });

  it('returns 503 while the database is unreachable and recovers after it returns', async () => {
    await proxy.stop();
    await waitForReady(port, 503);

    const live = await new Promise<number>((resolve, reject) => {
      const request = get(`http://127.0.0.1:${String(port)}/health/live`, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.on('error', reject);
    });
    expect(live).toBe(200);

    await proxy.start();
    await waitForReady(port, 200);
  });
});
