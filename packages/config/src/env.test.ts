import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  corsOriginsSchema,
  EnvValidationError,
  findEnvFile,
  loadEnv,
  nodeEnvSchema,
  portSchema,
} from './env';

describe('env schema primitives', () => {
  it('applies defaults', () => {
    expect(nodeEnvSchema.parse(undefined)).toBe('development');
  });

  it('coerces and bounds ports', () => {
    expect(portSchema.parse('3000')).toBe(3000);
    expect(portSchema.safeParse('0').success).toBe(false);
    expect(portSchema.safeParse('not-a-port').success).toBe(false);
  });

  it('splits and trims a CORS origin list', () => {
    expect(corsOriginsSchema.parse('http://a.test, http://b.test ,')).toEqual([
      'http://a.test',
      'http://b.test',
    ]);
    expect(corsOriginsSchema.safeParse(' , ').success).toBe(false);
  });
});

describe('loadEnv', () => {
  it('validates an explicit environment without touching files', () => {
    const schema = z.object({
      NODE_ENV: nodeEnvSchema,
      PORT: portSchema.default(3000),
    });

    expect(loadEnv(schema, { env: { NODE_ENV: 'test' } })).toEqual({
      NODE_ENV: 'test',
      PORT: 3000,
    });
  });

  it('reports missing variables without echoing values', () => {
    const schema = z.object({ DATABASE_URL: z.string().min(1) });

    expect(() => loadEnv(schema, { env: {} })).toThrowError(EnvValidationError);
    try {
      loadEnv(schema, { env: {} });
    } catch (error) {
      expect((error as Error).message).toContain('DATABASE_URL');
      expect((error as Error).message).not.toContain('postgres://');
    }
  });
});

describe('env file discovery', () => {
  const createdDirs: string[] = [];

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds the nearest .env walking up the tree', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'web-legend-env-'));
    createdDirs.push(rootDir);
    const nested = join(rootDir, 'apps', 'control-api');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(rootDir, '.env'), 'PORT=3000\n');

    expect(findEnvFile(nested)).toBe(join(rootDir, '.env'));
  });

  it('loads the discovered file into process.env', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'web-legend-env-'));
    createdDirs.push(rootDir);
    const nested = join(rootDir, 'packages', 'x');
    mkdirSync(nested, { recursive: true });
    const key = 'WEB_LEGEND_TEST_ENV_FILE_VALUE';
    writeFileSync(join(rootDir, '.env'), `${key}=from-file\n`);

    try {
      const schema = z.object({ [key]: z.string() });
      const parsed = loadEnv(schema, { startDir: nested });

      expect(parsed[key]).toBe('from-file');
    } finally {
      delete process.env[key];
    }
  });
});
