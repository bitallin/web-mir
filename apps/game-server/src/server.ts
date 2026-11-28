import { timingSafeEqual } from 'node:crypto';

import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import {
  adminCommandEnvelopeSchema,
  adminCommandReceiptSchema,
  adminGameServerStatusSchema,
  healthResponseSchema,
  readinessResponseSchema,
  type MapMonsterSpawn,
} from '@web-legend/contracts';
import { MAP_MANIFESTS } from '@web-legend/contracts/maps';
import { AssetService } from '@web-legend/game-application';
import type { ChatFilter } from '@web-legend/game-domain';
import { RuntimeMetrics } from '@web-legend/observability';
import { pingDatabase, type Database } from '@web-legend/persistence';
import express from 'express';
import type { Logger } from 'pino';

import { AdminCommandHub } from './admin/commandHub';
import type { GameServerEnv } from './env';
import { MetricsRegistry } from './metrics';
import { renderGameServerPrometheus } from './prometheus';
import { DiagnosticsRoom } from './rooms/diagnosticsRoom';
import { WorldMapRoom } from './rooms/worldMapRoom';
import { ContentStore, type ContentProvider } from './world/contentStore';
import { GuildInviteService } from './world/guildInvites';
import { createMapInstances } from './world/mapRegistry';
import { PlayerDirectory } from './world/playerDirectory';
import { PartyService } from './world/partyService';
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
  /** Overrides compiled monster spawns; tests disable them to isolate combat. */
  monsterSpawns?: readonly MapMonsterSpawn[];
  /** Test seam: disable owner auto-pickup when a test exercises manual loot. */
  autoPickup?: boolean;
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

/**
 * Browsers always send Origin on a WebSocket upgrade. Rejecting a missing or
 * unlisted origin in production prevents a third-party page from opening a
 * socket with the victim's cookies; development keeps the permissive default
 * so local tooling and the load client can connect without a browser.
 */
function createOriginCheck(
  allowedOrigins: readonly string[] | undefined,
): (request: Request) => Response | void {
  if (allowedOrigins === undefined || allowedOrigins.length === 0) {
    return () => undefined;
  }
  const allowAll = allowedOrigins.includes('*');
  return (request: Request) => {
    const origin = request.headers.get('origin');
    if (allowAll || (origin !== null && allowedOrigins.includes(origin))) {
      return undefined;
    }
    return new Response('websocket origin not allowed', { status: 403 });
  };
}

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
  const runtimeMetrics = new RuntimeMetrics();
  const contentStore =
    options.contentStore ??
    new ContentStore(database, logger, {
      realmCode: env.GAME_SERVER_REALM,
      requireRealm: env.NODE_ENV === 'production',
      refreshMs: options.contentRefreshMs ?? 5_000,
    });
  const adminHub = options.adminHub ?? new AdminCommandHub(logger);
  // Presence, party, friend and whisper delivery span map rooms, so they live
  // on the process rather than in a room (ADR-036, ADR-045, ADR-046).
  const playerDirectory = new PlayerDirectory();
  const partyService = new PartyService({ directory: playerDirectory });
  const guildInviteService = new GuildInviteService({ directory: playerDirectory });

  const server = new Server({
    // index.ts owns SIGTERM/SIGINT so it can drain rooms, stop metrics and
    // close the DB in order; Colyseus' own handler would call process.exit()
    // as soon as its branch finishes, racing the lease release (ADR-023).
    gracefullyShutdown: false,
    transport: new WebSocketTransport({
      pingInterval: 10_000,
      pingMaxRetries: 3,
      // Realtime commands are small; reject oversized frames before decoding.
      maxPayload: 4_096,
      beforeUpgrade: createOriginCheck(env.GAME_SERVER_ALLOWED_ORIGINS),
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

      app.get('/metrics/prometheus', (_request, response) => {
        response.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
        response
          .status(200)
          .send(
            renderGameServerPrometheus(
              metrics.snapshot(),
              runtimeMetrics.snapshot(),
              env.GAME_SERVER_REALM,
              SERVICE_VERSION,
            ),
          );
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
          realm: env.GAME_SERVER_REALM,
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
      partyService,
      guildInviteService,
      playerDirectory,
      realmCode: env.GAME_SERVER_REALM,
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
      runtimeMetrics.start();
      try {
        await contentStore.start();
      } catch (error) {
        runtimeMetrics.stop();
        throw error;
      }
      partyService.setMaxMembers(
        contentStore.snapshot().bundle.rules?.party?.maxMembers ?? partyService.maxMembers,
      );
      // Rooms only exist while a map has players, so an idle map would never
      // run its maintenance timer. Clear expired drops once at process start
      // (bounded batches, outside any tick) before accepting traffic.
      const assets = new AssetService(database);
      try {
        let removed = 0;
        for (let batch = 0; batch < 20; batch += 1) {
          const result = await assets.purgeExpiredDrops({ limit: 500 });
          removed += result.removedUnclaimed;
          if (result.removedUnclaimed < 500) {
            break;
          }
        }
        if (removed > 0) {
          logger.info({ removed }, 'purged expired world drops at startup');
        }
      } catch (error) {
        logger.warn({ err: error }, 'startup drop purge failed; rooms will retry');
      }
      await server.listen(env.GAME_SERVER_PORT, env.GAME_SERVER_HOST);
    },
    shutdown: async () => {
      contentStore.stop();
      runtimeMetrics.stop();
      await server.gracefullyShutdown(false);
    },
  };
}
