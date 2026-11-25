import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import {
  API_PREFIX,
  healthResponseSchema,
  PROTOCOL_VERSION,
  readinessResponseSchema,
} from '@web-legend/contracts';
import {
  renderPrometheus,
  RuntimeMetrics,
  runtimeMetricSamples,
  type PrometheusMetric,
} from '@web-legend/observability';
import type { Database } from '@web-legend/persistence';
import Fastify, { type FastifyError } from 'fastify';
import { performance } from 'node:perf_hooks';
import type { Logger } from 'pino';

import { ADMIN_LOGIN_RATE_LIMIT } from './http/adminCookies';
import { gameServerInternalUrl, type ControlApiEnv } from './env';
import {
  HttpMetrics,
  httpMetricSamples,
  OperationalMetrics,
  operationalMetricSamples,
} from './metrics';
import { AppError, codeForStatus, errorEnvelope } from './http/errors';
import { createOriginGuard } from './http/origin';
import { createRateLimiter } from './http/rateLimit';
import type { ReadinessProbe } from './readiness';
import { registerAdminAuthRoutes } from './routes/adminAuthRoutes';
import { registerAdminContentRoutes } from './routes/adminContentRoutes';
import { registerAdminRoutes } from './routes/adminRoutes';
import { registerAuthRoutes } from './routes/authRoutes';
import { registerCharacterRoutes } from './routes/characterRoutes';
import type { RouteDependencies } from './routes/context';
import { registerGameRoutes } from './routes/gameRoutes';
import { AdminService } from './services/admin';
import { AdminAuthService } from './services/adminAuth';
import { AuthService } from './services/auth';
import { CharacterService } from './services/characters';
import { ContentService } from './services/content';
import { GameServerClient, type GameServerGateway } from './services/gameServerClient';
import { TicketService } from './services/tickets';
import { SERVICE_VERSION } from './version';

export type AuthRateLimitConfig = {
  capacity: number;
  refillPerSecond: number;
};

export type BuildServerOptions = {
  env: ControlApiEnv;
  logger: Logger;
  readiness: ReadinessProbe;
  database: Database;
  startedAt?: number;
  authRateLimit?: AuthRateLimitConfig;
  adminRateLimit?: AuthRateLimitConfig;
  /** Tests can inject a stub; production talks to the real internal endpoint. */
  gameServerClient?: GameServerGateway;
};

const MAX_REQUEST_ID_LENGTH = 128;
const DEFAULT_AUTH_RATE_LIMIT: AuthRateLimitConfig = { capacity: 30, refillPerSecond: 1 };

function resolveRequestId(headerValue: string | string[] | undefined): string {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (
    candidate !== undefined &&
    candidate.length > 0 &&
    candidate.length <= MAX_REQUEST_ID_LENGTH
  ) {
    return candidate;
  }
  return randomUUID();
}

export async function buildServer(options: BuildServerOptions) {
  const startedAt = options.startedAt ?? Date.now();

  const app = Fastify({
    loggerInstance: options.logger,
    genReqId: (request) => resolveRequestId(request.headers['x-request-id']),
    // Authentication payloads are tiny; reject oversized bodies early.
    bodyLimit: 16_384,
    // Only enable behind the production reverse proxy; otherwise a direct
    // client could spoof X-Forwarded-For and evade per-IP rate limits.
    trustProxy: options.env.TRUST_PROXY === 'true',
  });

  const httpMetrics = new HttpMetrics();
  const operationalMetrics = new OperationalMetrics(options.database, options.logger);
  const runtimeMetrics = new RuntimeMetrics();
  runtimeMetrics.start();
  operationalMetrics.start();
  const requestStartedAt = new WeakMap<object, number>();

  // Fastify 5 treats non-async onRequest hooks as callback-style and never
  // completes the request if the hook does not invoke `done`; keep it async.
  // eslint-disable-next-line @typescript-eslint/require-await
  app.addHook('onRequest', async (request) => {
    requestStartedAt.set(request, performance.now());
    httpMetrics.startRequest();
  });

  app.addHook('onResponse', async (request, reply) => {
    const startedAt = requestStartedAt.get(request) ?? performance.now();
    requestStartedAt.delete(request);
    const route = request.routeOptions.url ?? 'unmatched';
    httpMetrics.endRequest(
      request.method,
      route,
      reply.statusCode,
      Math.max(0, performance.now() - startedAt) / 1000,
    );
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
  });

  app.addHook('onClose', () => {
    operationalMetrics.stop();
    runtimeMetrics.stop();
  });

  await app.register(cors, {
    origin: options.env.CORS_ORIGINS,
  });

  const rateLimitConfig = options.authRateLimit ?? DEFAULT_AUTH_RATE_LIMIT;
  const adminRateLimitConfig = options.adminRateLimit ?? ADMIN_LOGIN_RATE_LIMIT;
  const content = new ContentService(options.database, options.logger);
  const gameServerClient =
    options.gameServerClient ??
    new GameServerClient(gameServerInternalUrl(options.env), options.env.INTERNAL_ADMIN_TOKEN);
  const dependencies: RouteDependencies = {
    auth: new AuthService(options.database),
    characters: new CharacterService(options.database, content),
    tickets: new TicketService(options.database),
    adminAuth: new AdminAuthService(options.database),
    admin: new AdminService(options.database, content, gameServerClient, options.logger),
    content,
    rateLimit: createRateLimiter(rateLimitConfig),
    adminRateLimit: createRateLimiter(adminRateLimitConfig),
    secureCookies: options.env.NODE_ENV === 'production',
  };

  app.addHook('onRequest', createOriginGuard(options.env.CORS_ORIGINS));

  app.get(API_PREFIX, () => ({
    service: 'control-api',
    version: SERVICE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
  }));

  app.get('/health/live', () =>
    healthResponseSchema.parse({
      status: 'ok',
      service: 'control-api',
      version: SERVICE_VERSION,
      uptimeSeconds: Math.max(0, (Date.now() - startedAt) / 1_000),
      timestamp: new Date().toISOString(),
    }),
  );

  app.get('/health/ready', async (_request, reply) => {
    const checks = await options.readiness();
    const healthy = checks.every((check) => check.status === 'ok');

    const body = readinessResponseSchema.parse({
      status: healthy ? 'ok' : 'degraded',
      service: 'control-api',
      version: SERVICE_VERSION,
      checks,
      timestamp: new Date().toISOString(),
    });

    return reply.status(healthy ? 200 : 503).send(body);
  });

  app.get('/metrics/prometheus', async (_request, reply) => {
    const metrics: PrometheusMetric[] = [
      {
        name: 'web_legend_control_api_up',
        help: 'Control API liveness as seen by the process itself.',
        type: 'gauge',
        points: [{ labels: { version: SERVICE_VERSION }, value: 1 }],
      },
      ...httpMetricSamples(httpMetrics.snapshot(), httpMetrics.inFlightCount()),
      ...operationalMetricSamples(operationalMetrics.snapshot()),
      ...runtimeMetricSamples(runtimeMetrics.snapshot()),
    ];
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(renderPrometheus(metrics));
  });

  registerAuthRoutes(app, dependencies);
  registerCharacterRoutes(app, dependencies);
  registerGameRoutes(app, dependencies);
  registerAdminAuthRoutes(app, dependencies);
  registerAdminRoutes(app, dependencies);
  registerAdminContentRoutes(app, dependencies);

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send(errorEnvelope('NOT_FOUND', 'Route not found', request.id)),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send(errorEnvelope(error.code, error.message, request.id, error.details));
    }

    const statusCode = error.statusCode ?? 500;
    const code = codeForStatus(statusCode);

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'request failed');
      return reply
        .status(statusCode)
        .send(errorEnvelope('INTERNAL_ERROR', 'Internal server error', request.id));
    }

    return reply
      .status(statusCode)
      .send(errorEnvelope(code, error.message || 'Request rejected', request.id));
  });

  return app;
}
