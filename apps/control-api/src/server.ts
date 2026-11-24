import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import {
  API_PREFIX,
  apiErrorSchema,
  healthResponseSchema,
  PROTOCOL_VERSION,
  readinessResponseSchema,
  type ApiError,
  type ApiErrorCode,
} from '@web-legend/contracts';
import Fastify, { type FastifyError } from 'fastify';
import type { Logger } from 'pino';

import type { ControlApiEnv } from './env';
import type { ReadinessProbe } from './readiness';
import { SERVICE_VERSION } from './version';

export type BuildServerOptions = {
  env: ControlApiEnv;
  logger: Logger;
  readiness: ReadinessProbe;
  startedAt?: number;
};

const MAX_REQUEST_ID_LENGTH = 128;

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

function codeForStatus(statusCode: number): ApiErrorCode {
  switch (statusCode) {
    case 400:
    case 422:
      return 'VALIDATION_ERROR';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return statusCode >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR';
  }
}

function errorEnvelope(code: ApiErrorCode, message: string, requestId: string): ApiError {
  return apiErrorSchema.parse({ error: { code, message, requestId } });
}

export async function buildServer(options: BuildServerOptions) {
  const startedAt = options.startedAt ?? Date.now();

  const app = Fastify({
    loggerInstance: options.logger,
    genReqId: (request) => resolveRequestId(request.headers['x-request-id']),
  });

  await app.register(cors, {
    origin: options.env.CORS_ORIGINS,
  });

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

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send(errorEnvelope('NOT_FOUND', 'Route not found', request.id)),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
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
