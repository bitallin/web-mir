import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import {
  API_PREFIX,
  healthResponseSchema,
  PROTOCOL_VERSION,
  readinessResponseSchema,
} from '@web-legend/contracts';
import type { Database } from '@web-legend/persistence';
import Fastify, { type FastifyError } from 'fastify';
import type { Logger } from 'pino';

import type { ControlApiEnv } from './env';
import { AppError, codeForStatus, errorEnvelope } from './http/errors';
import { createOriginGuard } from './http/origin';
import { createRateLimiter } from './http/rateLimit';
import type { ReadinessProbe } from './readiness';
import { registerAuthRoutes } from './routes/authRoutes';
import { registerCharacterRoutes } from './routes/characterRoutes';
import type { RouteDependencies } from './routes/context';
import { registerGameRoutes } from './routes/gameRoutes';
import { AuthService } from './services/auth';
import { CharacterService } from './services/characters';
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
  });

  await app.register(cors, {
    origin: options.env.CORS_ORIGINS,
  });

  const rateLimitConfig = options.authRateLimit ?? DEFAULT_AUTH_RATE_LIMIT;
  const dependencies: RouteDependencies = {
    auth: new AuthService(options.database),
    characters: new CharacterService(options.database),
    tickets: new TicketService(options.database),
    rateLimit: createRateLimiter(rateLimitConfig),
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

  registerAuthRoutes(app, dependencies);
  registerCharacterRoutes(app, dependencies);
  registerGameRoutes(app, dependencies);

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send(errorEnvelope('NOT_FOUND', 'Route not found', request.id)),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send(errorEnvelope(error.code, error.message, request.id));
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
