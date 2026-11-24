import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { healthResponseSchema, readinessResponseSchema } from '@web-legend/contracts';
import type { Logger } from 'pino';

import type { GameServerEnv } from './env';
import { DiagnosticsRoom } from './rooms/diagnosticsRoom';
import { SERVICE_VERSION } from './version';

export type CreateGameServerOptions = {
  env: GameServerEnv;
  logger: Logger;
};

export type GameServerRuntime = {
  server: Server;
  listen: () => Promise<void>;
  shutdown: () => Promise<void>;
};

export function createGameServer(options: CreateGameServerOptions): GameServerRuntime {
  const startedAt = Date.now();
  const { env, logger } = options;

  const server = new Server({
    transport: new WebSocketTransport({
      pingInterval: 10_000,
      pingMaxRetries: 3,
    }),
    greet: false,
    logger,
    express: (app) => {
      app.get('/health/live', (_request, response) => {
        response.status(200).json(
          healthResponseSchema.parse({
            status: 'ok',
            service: 'game-server',
            version: SERVICE_VERSION,
            uptimeSeconds: Math.max(0, (Date.now() - startedAt) / 1_000),
            timestamp: new Date().toISOString(),
          }),
        );
      });

      app.get('/health/ready', (_request, response) => {
        response.status(200).json(
          readinessResponseSchema.parse({
            status: 'ok',
            service: 'game-server',
            version: SERVICE_VERSION,
            checks: [{ name: 'room-runtime', status: 'ok' }],
            timestamp: new Date().toISOString(),
          }),
        );
      });
    },
  });

  if (env.NODE_ENV !== 'production') {
    server.define('diagnostics', DiagnosticsRoom);
  }

  return {
    server,
    listen: async () => {
      await server.listen(env.GAME_SERVER_PORT, env.GAME_SERVER_HOST);
    },
    shutdown: async () => {
      await server.gracefullyShutdown(false);
    },
  };
}
