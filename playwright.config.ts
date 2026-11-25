import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

// Capture explicit shell overrides before `.env` is loaded: the development
// stack uses ports 84–87 and must never be reused by the isolated E2E stack.
const explicitGameWebPort = process.env.GAME_WEB_PORT;
const explicitAdminWebPort = process.env.ADMIN_WEB_PORT;
const explicitControlApiPort = process.env.CONTROL_API_PORT;
const explicitGameServerPort = process.env.GAME_SERVER_PORT;

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const E2E_DATABASE_NAME = process.env.E2E_DATABASE_NAME ?? 'web_legend_e2e';

function scopedDatabaseUrl(baseUrl: string, name: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

function e2eDatabaseUrl(): string {
  const explicit = process.env.E2E_DATABASE_URL;
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (base === undefined || base.length === 0) {
    throw new Error('E2E needs DATABASE_URL or E2E_DATABASE_URL to provision its own database');
  }
  return scopedDatabaseUrl(base, E2E_DATABASE_NAME);
}

const databaseUrl = e2eDatabaseUrl();
// The teardown and the web-server commands read these; keeping them in the
// environment makes a bare `playwright test` self-provisioning.
process.env.E2E_DATABASE_URL = databaseUrl;
process.env.E2E_DATABASE_NAME = E2E_DATABASE_NAME;

const gameWebPort = process.env.E2E_GAME_WEB_PORT ?? explicitGameWebPort ?? '5184';
const adminWebPort = process.env.E2E_ADMIN_WEB_PORT ?? explicitAdminWebPort ?? '5185';
const controlApiPort = process.env.E2E_CONTROL_API_PORT ?? explicitControlApiPort ?? '3086';
const gameServerPort = process.env.E2E_GAME_SERVER_PORT ?? explicitGameServerPort ?? '2587';
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === 'true';
const reuseExistingServer = process.env.E2E_REUSE_SERVER === 'true';
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
// This host renders WebGL in software; more than two browsers at once has
// produced 250ms/attack-timing flakes. Override with PLAYWRIGHT_WORKERS.
const workerOverride = Number(process.env.PLAYWRIGHT_WORKERS ?? '2');
const workers = Number.isInteger(workerOverride) && workerOverride > 0 ? workerOverride : 2;

// Specs read these to build absolute admin/LAN URLs. Normalising them here
// keeps the test process, the web servers and the browser on one port set even
// when the developer's `.env` describes the shared development stack.
process.env.GAME_WEB_PORT = gameWebPort;
process.env.ADMIN_WEB_PORT = adminWebPort;
process.env.CONTROL_API_PORT = controlApiPort;
process.env.GAME_SERVER_PORT = gameServerPort;

const serverEnv = {
  DATABASE_URL: databaseUrl,
  GAME_WEB_PORT: gameWebPort,
  ADMIN_WEB_PORT: adminWebPort,
  CONTROL_API_PORT: controlApiPort,
  GAME_SERVER_PORT: gameServerPort,
  GAME_SERVER_ID: process.env.GAME_SERVER_ID ?? 'game-server-e2e',
  // Keep the E2E stack's origins and admin credentials deterministic even when
  // the developer's `.env` points at the shared development stack.
  CORS_ORIGINS: `http://127.0.0.1:${gameWebPort},http://127.0.0.1:${adminWebPort}`,
  ADMIN_SEED_USERNAME: process.env.ADMIN_SEED_USERNAME ?? 'admin',
  ADMIN_SEED_PASSWORD: process.env.ADMIN_SEED_PASSWORD ?? 'web-legend-admin',
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers,
  forbidOnly: process.env.CI === 'true',
  retries: process.env.CI === 'true' ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalTeardown: './tests/e2e/globalTeardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${gameWebPort}`,
    trace: 'on-first-retry',
    launchOptions: {
      // This host exports HTTP(S)_PROXY; browser tests must reach the local
      // dev servers and LAN origins directly.
      args: ['--no-proxy-server'],
      ...(chromiumExecutable === undefined ? {} : { executablePath: chromiumExecutable }),
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  ...(skipWebServer
    ? {}
    : {
        webServer: [
          {
            command: 'pnpm --filter @web-legend/game-web dev',
            url: `http://127.0.0.1:${gameWebPort}`,
            reuseExistingServer,
            env: serverEnv,
            timeout: 120_000,
          },
          {
            command: 'pnpm --filter @web-legend/admin-web dev',
            url: `http://127.0.0.1:${adminWebPort}`,
            reuseExistingServer,
            env: serverEnv,
            timeout: 120_000,
          },
          {
            // Provision the throwaway database before the API starts: migrations
            // and the default realm are prerequisites for real registration.
            command:
              'tsx infra/scripts/e2e-database.ts prepare && pnpm db:migrate && pnpm db:seed && pnpm --filter @web-legend/control-api dev',
            url: `http://127.0.0.1:${controlApiPort}/health/live`,
            reuseExistingServer,
            env: serverEnv,
            timeout: 180_000,
          },
          {
            command: 'pnpm --filter @web-legend/game-server dev',
            url: `http://127.0.0.1:${gameServerPort}/health/live`,
            reuseExistingServer,
            env: serverEnv,
            timeout: 120_000,
          },
        ],
      }),
});
