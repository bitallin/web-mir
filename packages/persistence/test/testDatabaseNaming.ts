import { randomUUID } from 'node:crypto';

/**
 * Pure naming helpers shared by vitest.config.ts and the global setup. Keeping
 * this file free of database imports stops the config loader from pulling the
 * whole persistence graph into its native config evaluation.
 */
export const TEST_DATABASE_PREFIX = 'wl_test_';
export const STALE_DATABASE_MS = 24 * 60 * 60 * 1_000;

export function testDatabaseName(now = Date.now()): string {
  return `${TEST_DATABASE_PREFIX}${now.toString(36)}_${randomUUID().slice(0, 8)}`;
}

export function testDatabaseBaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const url = env.TEST_DATABASE_URL ?? env.DATABASE_URL;
  return url === undefined || url.length === 0 ? undefined : url;
}

/** Replaces the database in the connection path, keeping credentials and host. */
export function testDatabaseUrl(baseUrl: string, name: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export function timestampFromDatabaseName(name: string): number | undefined {
  const suffix = name.slice(TEST_DATABASE_PREFIX.length).split('_')[0];
  if (suffix === undefined || suffix.length === 0) {
    return undefined;
  }
  const value = Number.parseInt(suffix, 36);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
