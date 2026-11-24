import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import {
  healthResponseSchema,
  readinessResponseSchema,
  WORLD_ROOM_NAME,
} from '@web-legend/contracts';
import type { Logger } from 'pino';

import type { GameServerEnv } from './env';
import { MetricsRegistry } from './metrics';
import { DiagnosticsRoom } from './rooms/diagnosticsRoom';
import { WorldMapRoom } from './rooms/worldMapRoom';
import { SERVICE_VERSION } from './version';

export type WorldRoomTuning = {
  tickHz?: number;
  patchRateMs?: number;
  reconnectGraceSeconds?: number;
  commandRateCapacity?: number;
  commandRateRefillPerSecond?: number;
};

export type CreateGameServerOptions = {
  env: GameServerEnv;
  logger: Logger;
  world?: WorldRoomTuning;
};

export type GameServerRuntime = {
  server: Server;
  metrics: MetricsRegistry;
  listen: () => Promise<void>;
  shutdown: () => Promise<void>;
};

export function createGameServer(options: CreateGameServerOptions): GameServerRuntime {
  const startedAt = Date.now();
  const { env, logger } = options;
  const metrics = new MetricsRegistry();

  const server = new Server({
    transport: new WebSocketTransport({
      pingInterval: 10_000,
      pingMaxRetries: 3,
      // Realtime commands are small; reject oversized frames before decoding.
      maxPayload: 4_096,
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

      app.get('/metrics', (_request, response) => {
        response.status(200).json(metrics.snapshot());
      });
    },
  });

  server.define(WORLD_ROOM_NAME, WorldMapRoom, {
    // Phase 2 replaces this with one-time game tickets (ADR-015).
    allowDevIdentity: env.NODE_ENV !== 'production',
    logger,
    metrics,
    ...options.world,
  });

  if (env.NODE_ENV !== 'production') {
    server.define('diagnostics', DiagnosticsRoom);
  }

  return {
    server,
    metrics,
    listen: async () => {
      await server.listen(env.GAME_SERVER_PORT, env.GAME_SERVER_HOST);
    },
    shutdown: async () => {
      await server.gracefullyShutdown(false);
    },
  };
}
