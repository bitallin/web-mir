import { describe, expect, it } from 'vitest';

import { apiErrorSchema } from './errors';
import { healthResponseSchema, readinessResponseSchema } from './health';
import { PROTOCOL_VERSION } from './protocol';

const timestamp = new Date('2026-11-24T00:00:00.000Z').toISOString();

describe('health contracts', () => {
  it('accepts a valid liveness payload', () => {
    const parsed = healthResponseSchema.parse({
      status: 'ok',
      service: 'control-api',
      version: '0.0.0',
      uptimeSeconds: 1.5,
      timestamp,
    });

    expect(parsed.status).toBe('ok');
    expect(parsed.service).toBe('control-api');
  });

  it('rejects unknown services and negative uptime', () => {
    expect(
      healthResponseSchema.safeParse({
        status: 'ok',
        service: 'worker',
        version: '0.0.0',
        uptimeSeconds: -1,
        timestamp,
      }).success,
    ).toBe(false);
  });

  it('requires at least one readiness check', () => {
    expect(
      readinessResponseSchema.safeParse({
        status: 'ok',
        service: 'game-server',
        version: '0.0.0',
        checks: [],
        timestamp,
      }).success,
    ).toBe(false);

    expect(
      readinessResponseSchema.parse({
        status: 'degraded',
        service: 'game-server',
        version: '0.0.0',
        checks: [{ name: 'database', status: 'error', detail: 'unreachable' }],
        timestamp,
      }).status,
    ).toBe('degraded');
  });
});

describe('error contract', () => {
  it('accepts the canonical error envelope', () => {
    const parsed = apiErrorSchema.parse({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        requestId: 'req-1',
      },
    });

    expect(parsed.error.code).toBe('NOT_FOUND');
  });

  it('rejects non-canonical error codes', () => {
    expect(
      apiErrorSchema.safeParse({
        error: { code: 'OOPS', message: 'x', requestId: 'r' },
      }).success,
    ).toBe(false);
  });
});

describe('protocol version', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});
