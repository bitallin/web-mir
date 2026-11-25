import { timingSafeEqual } from 'node:crypto';

import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import {
  adminCommandEnvelopeSchema,
  adminCommandReceiptSchema,
  adminGameServerStatusSchema,
  healthResponseSchema,
  readinessResponseSchema,
} from '@web-legend/contracts';
import { MAP_MANIFESTS } from '@web-legend/contracts/maps';
import type { ChatFilter } from '@web-legend/game-domain';
import { pingDatabase, type Database } from '@web-legend/persistence';
import express from 'express';
import type { Logger } from 'pino';

import { AdminCommandHub } from './admin/commandHub';
import type { GameServerEnv } from './env';
import { MetricsRegistry } from './metrics';
import { DiagnosticsRoom } from './rooms/diagnosticsRoom';
import { WorldMapRoom } from './rooms/worldMapRoom';
import { ContentStore, type ContentProvider } from './world/contentStore';
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
  chatFilter?: ChatFilter;
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
  /** Tests may inject a fixed store/hub; production builds them here. */
  contentStore?: ContentProvider;
  adminHub?: AdminCommandHub;
  contentRefreshMs?: number;
};

export type GameServerRuntime = {
  server: Server;
  metrics: MetricsRegistry;
  contentStore: ContentProvider;
  adminHub: AdminCommandHub;
  listen: () => Promise<void>;
  shutdown: () => Promise<void>;
};

function tokenMatches(expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string') {
    return false;
  }
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(provided, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createGameServer(options: CreateGameServerOptions): GameServerRuntime {
  const startedAt = Date.now();
  const { env, logger, database } = options;
  const metrics = new MetricsRegistry();
  const contentStore =
    options.contentStore ?? new ContentStore(database, logger, options.contentRefreshMs ?? 5_000);
  const adminHub = options.adminHub ?? new AdminCommandHub(logger);

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

      // Internal control plane for the admin outbox. The reverse proxy must
      // never expose /internal publicly (phase 8 runbook).
      app.use('/internal', express.json({ limit: '16kb' }));

      app.get('/internal/admin/status', (request, response) => {
        if (!tokenMatches(env.INTERNAL_ADMIN_TOKEN, request.header('x-internal-admin-token'))) {
          response.status(401).json({ error: 'unauthorized' });
          return;
        }
        const rooms = adminHub.rooms();
        const status = adminGameServerStatusSchema.parse({
          service: 'game-server',
          serverId: env.GAME_SERVER_ID,
          uptimeSeconds: Math.max(0, (Date.now() - startedAt) / 1_000),
          rooms,
          totals: {
            rooms: rooms.length,
            players: rooms.reduce((total, room) => total + room.players, 0),
            activeCommands: adminHub.processedCount(),
          },
          timestamp: new Date().toISOString(),
        });
        response.status(200).json(status);
      });

      app.post('/internal/admin/commands', async (request, response) => {
        if (!tokenMatches(env.INTERNAL_ADMIN_TOKEN, request.header('x-internal-admin-token'))) {
          response.status(401).json({ error: 'unauthorized' });
          return;
        }
        const body: unknown = request.body;
        const parsed = adminCommandEnvelopeSchema.safeParse(body);
        if (!parsed.success) {
          response.status(400).json({ error: 'invalid command payload' });
          return;
        }
        const result = await adminHub.dispatch(parsed.data);
        response.status(200).json(
          adminCommandReceiptSchema.parse({
            ...result,
            timestamp: new Date().toISOString(),
          }),
        );
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
      contentStore,
      adminHub,
      ...options.world,
    });
  }

  if (env.NODE_ENV !== 'production') {
    server.define('diagnostics', DiagnosticsRoom);
  }

  return {
    server,
    metrics,
    contentStore,
    adminHub,
    listen: async () => {
      await contentStore.start();
      await server.listen(env.GAME_SERVER_PORT, env.GAME_SERVER_HOST);
    },
    shutdown: async () => {
      contentStore.stop();
      await server.gracefullyShutdown(false);
    },
  };
}
