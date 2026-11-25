import { createServer as createNetServer } from 'node:net';

import { Client, type Room as SdkRoom } from '@colyseus/sdk';
import { healthResponseSchema, readinessResponseSchema } from '@web-legend/contracts';
import { createLogger } from '@web-legend/observability';
import { createDatabase, type DatabaseHandle } from '@web-legend/persistence';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { GameServerEnv } from '../src/env';
import { createGameServer, type GameServerRuntime } from '../src/server';

const pongSchema = z.object({
  sequence: z.number().int().nonnegative(),
  sentAt: z.number().nonnegative(),
  serverTime: z.number().nonnegative(),
});

async function reservePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('Failed to reserve a TCP port'));
        return;
      }
      const { port } = address;
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function waitForMessage(room: SdkRoom, type: string, timeoutMs = 5_000): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for "${type}"`));
    }, timeoutMs);

    unsubscribe = room.onMessage(type, (payload: unknown) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(payload);
    });
  });
}

async function ping(room: SdkRoom, sequence: number): Promise<z.infer<typeof pongSchema>> {
  const response = waitForMessage(room, 'diagnostics.pong');
  room.send('diagnostics.ping', { sequence, sentAt: Date.now() });
  return pongSchema.parse(await response);
}

describe('game server runtime', () => {
  let runtime: GameServerRuntime;
  let database: DatabaseHandle;
  let client: Client;
  let baseUrl: string;

  beforeAll(async () => {
    const port = await reservePort();
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) {
      throw new Error('DATABASE_URL is required for game server integration tests');
    }
    database = createDatabase(databaseUrl, { max: 2 });
    const env: GameServerEnv = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      GAME_SERVER_HOST: '127.0.0.1',
      GAME_SERVER_PORT: port,
      DATABASE_URL: databaseUrl,
      GAME_SERVER_ID: 'game-server-test',
      INTERNAL_ADMIN_TOKEN: 'test-internal-admin-token-123',
    };

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
    baseUrl = `http://127.0.0.1:${port}`;
    client = new Client(baseUrl);
  });

  afterAll(async () => {
    await runtime?.shutdown();
    await database?.close();
  });

  it('serves liveness and readiness over HTTP', async () => {
    const liveResponse = await fetch(`${baseUrl}/health/live`);
    const liveBody: unknown = await liveResponse.json();

    expect(liveResponse.status).toBe(200);
    expect(healthResponseSchema.parse(liveBody)).toMatchObject({
      status: 'ok',
      service: 'game-server',
    });

    const readyResponse = await fetch(`${baseUrl}/health/ready`);
    const readyBody: unknown = await readyResponse.json();

    expect(readyResponse.status).toBe(200);
    const readiness = readinessResponseSchema.parse(readyBody);
    expect(readiness.status).toBe('ok');
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'room-runtime', status: 'ok' }),
        expect.objectContaining({ name: 'database', status: 'ok' }),
      ]),
    );
  });

  it('accepts a real websocket client and validates messages', async () => {
    const room = await client.joinOrCreate('diagnostics');

    expect(room.sessionId).toEqual(expect.any(String));

    const pong = await ping(room, 1);
    expect(pong.sequence).toBe(1);
    expect(pong.serverTime).toBeGreaterThan(0);

    await room.leave();
  });

  it('reconnects an unconsented drop within the grace period', async () => {
    const room = await client.joinOrCreate('diagnostics');
    const sessionId = room.sessionId;
    // The SDK refuses automatic reconnection during a room's first 5 seconds.
    room.reconnection.minUptime = 0;

    const reconnected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for reconnect'));
      }, 10_000);

      room.onReconnect.once(() => {
        clearTimeout(timer);
        resolve();
      });
    });

    room.connection.close();

    await reconnected;
    expect(room.sessionId).toBe(sessionId);

    const pong = await ping(room, 2);
    expect(pong.sequence).toBe(2);

    await room.leave();
  });
});
