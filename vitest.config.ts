import { existsSync } from 'node:fs';

import { defineConfig } from 'vitest/config';

import {
  testDatabaseBaseUrl,
  testDatabaseName,
  testDatabaseUrl as scopedTestDatabaseUrl,
} from './packages/persistence/test/testDatabaseNaming';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

// `pnpm test` runs against a throwaway database so repeated and parallel runs
// do not leave releases, audits or items in the development database (ADR-024).
const testDatabaseBase = testDatabaseBaseUrl();
const testDatabase = testDatabaseName();
const testDatabaseUrl =
  testDatabaseBase === undefined
    ? undefined
    : scopedTestDatabaseUrl(testDatabaseBase, testDatabase);
if (testDatabaseUrl !== undefined) {
  process.env.VITEST_TEST_DATABASE = testDatabase;
}

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    ...(testDatabaseUrl === undefined
      ? {}
      : {
          env: { DATABASE_URL: testDatabaseUrl, VITEST_TEST_DATABASE: testDatabase },
          globalSetup: ['./packages/persistence/test/databaseGlobalSetup.ts'],
        }),
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: ['**/index.ts'],
    },
  },
});
