import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { healthResponseSchema, readinessResponseSchema } from '@web-legend/contracts';
import { MAP_MANIFESTS } from '@web-legend/contracts/maps';
import { pingDatabase, type Database } from '@web-legend/persistence';
import type { Logger } from 'pino';

import type { GameServerEnv } from './env';
import { MetricsRegistry } from './metrics';
import { DiagnosticsRoom } from './rooms/diagnosticsRoom';
import { WorldMapRoom } from './rooms/worldMapRoom';
import { createMapInstances } from './world/mapRegistry';
import { SERVICE_VERSION } from './version';

export type WorldRoomTuning = {
  tickHz?: number;
  patchRateMs?: number;
  reconnectGraceSeconds?: number;
  commandRateCapacity?: number;
  commandRateRefillPerSecond?: number;
  chatRateCapacity?: number;
  chatRateRefillPerSecond?: number;
  checkpointIntervalMs?: number;
  interestCellSize?: number;
  interestRadiusCells?: number;
  combatRng?: () => number;
  economyRng?: () => number;
  monsterRespawnMs?: number;
  playerRespawnMs?: number;
};

export type CreateGameServerOptions = {
  env: GameServerEnv;
  logger: Logger;
  database: Database;
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
  const { env, logger, database } = options;
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

      app.get('/health/ready', async (_request, response) => {
        const databaseOk = await pingDatabase(database);
        if (!databaseOk) {
          logger.warn('game server readiness database check failed');
        }

        const checks = [
          { name: 'room-runtime', status: 'ok' as const },
          {
            name: 'database',
            status: databaseOk ? ('ok' as const) : ('error' as const),
            ...(databaseOk ? {} : { detail: 'database unreachable' }),
          },
        ];
        const healthy = databaseOk;

        response.status(healthy ? 200 : 503).json(
          readinessResponseSchema.parse({
            status: healthy ? 'ok' : 'degraded',
            service: 'game-server',
            version: SERVICE_VERSION,
            checks,
            timestamp: new Date().toISOString(),
          }),
        );
      });

      app.get('/metrics', (_request, response) => {
        response.status(200).json(metrics.snapshot());
      });
    },
  });

  // One fixed instance per map template for the MVP (ADR-018). The room type
  // name carries the map id so matchmaking can never put a character in the
  // wrong map room; the server still validates the persisted map on join.
  for (const mapInstance of createMapInstances(MAP_MANIFESTS)) {
    server.define(mapInstance.roomName, WorldMapRoom, {
      database,
      serverId: env.GAME_SERVER_ID,
      logger,
      metrics,
      mapInstance,
      ...options.world,
    });
  }

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
