import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';

import { Client } from '@colyseus/sdk';
import { PROTOCOL_VERSION, WORLD_ROOM_NAME } from '@web-legend/contracts';
import { createLogger } from '@web-legend/observability';
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
  let baseUrl: string;

  beforeAll(async () => {
    const port = await reservePort();
    const env: GameServerEnv = {
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      GAME_SERVER_HOST: '127.0.0.1',
      GAME_SERVER_PORT: port,
    };
    runtime = createGameServer({
      env,
      logger: createLogger({
        service: 'game-server',
        level: 'silent',
        destination: { write: () => undefined },
      }),
    });
    await runtime.listen();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await runtime?.shutdown();
  });

  it('refuses the development identity without a game ticket', async () => {
    const client = new Client(baseUrl);

    await expect(
      client.create(WORLD_ROOM_NAME, {
        protocolVersion: PROTOCOL_VERSION,
        displayName: 'Alice',
        playerKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 525 });
  });

  it('does not register the diagnostics room', async () => {
    const client = new Client(baseUrl);

    await expect(client.create('diagnostics')).rejects.toMatchObject({ code: 520 });
  });
});
