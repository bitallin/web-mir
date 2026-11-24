import { createServer as createNetServer } from 'node:net';

import { Client } from '@colyseus/sdk';
import { PROTOCOL_VERSION, WORLD_ROOM_NAME } from '@web-legend/contracts';
import { createLogger } from '@web-legend/observability';
import { createDatabase, type DatabaseHandle } from '@web-legend/persistence';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { GameServerEnv } from '../src/env';
import { createGameServer, type GameServerRuntime } from '../src/server';

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

/**
 * Colyseus room handlers are process-global, so the production server is
 * exercised in its own test file (and therefore its own worker process) to
 * prove that development-only rooms and identity never leak into production.
 */
describe('production game server', () => {
  let runtime: GameServerRuntime;
  let database: DatabaseHandle;
  let baseUrl: string;

  beforeAll(async () => {
    const port = await reservePort();
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) {
      throw new Error('DATABASE_URL is required for production gate integration tests');
    }
    database = createDatabase(databaseUrl, { max: 2 });
    const env: GameServerEnv = {
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      GAME_SERVER_HOST: '127.0.0.1',
      GAME_SERVER_PORT: port,
      DATABASE_URL: databaseUrl,
      GAME_SERVER_ID: 'game-server-production-test',
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
  });

  afterAll(async () => {
    await runtime?.shutdown();
    await database?.close();
  });

  it('refuses a forged ticket even in production', async () => {
    const client = new Client(baseUrl);

    await expect(
      client.create(WORLD_ROOM_NAME, {
        protocolVersion: PROTOCOL_VERSION,
        ticket: 'A'.repeat(43),
      }),
    ).rejects.toMatchObject({ code: 525 });
  });

  it('refuses self-reported identity fields instead of a ticket', async () => {
    const client = new Client(baseUrl);

    await expect(
      client.create(WORLD_ROOM_NAME, {
        protocolVersion: PROTOCOL_VERSION,
        ticket: 'A'.repeat(43),
        accountId: 'admin',
        characterId: 'admin',
      }),
    ).rejects.toMatchObject({ code: 525 });
  });

  it('does not register the diagnostics room', async () => {
    const client = new Client(baseUrl);

    await expect(client.create('diagnostics')).rejects.toMatchObject({ code: 520 });
  });
});
