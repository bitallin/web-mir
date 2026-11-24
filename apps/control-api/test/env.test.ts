import { loadEnv } from '@web-legend/config';
import { describe, expect, it } from 'vitest';

import { controlApiEnvSchema } from '../src/env';

const validEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  CONTROL_API_HOST: '127.0.0.1',
  CONTROL_API_PORT: '3000',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/web_legend',
  CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174',
} satisfies NodeJS.ProcessEnv;

describe('control API environment', () => {
  it('parses a valid environment', () => {
    const parsed = loadEnv(controlApiEnvSchema, { env: validEnv });

    expect(parsed.CONTROL_API_PORT).toBe(3000);
    expect(parsed.CORS_ORIGINS).toEqual(['http://localhost:5173', 'http://localhost:5174']);
  });

  it('rejects a missing database URL', () => {
    const { DATABASE_URL: _omitted, ...withoutDatabase } = validEnv;

    expect(() => loadEnv(controlApiEnvSchema, { env: withoutDatabase })).toThrow(/DATABASE_URL/u);
  });

  it('rejects a non-postgres database URL', () => {
    expect(() =>
      loadEnv(controlApiEnvSchema, {
        env: { ...validEnv, DATABASE_URL: 'mysql://localhost/db' },
      }),
    ).toThrow(/postgres/u);
  });
});
