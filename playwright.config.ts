import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const gameWebPort = process.env.GAME_WEB_PORT ?? '5173';
const adminWebPort = process.env.ADMIN_WEB_PORT ?? '5174';
const controlApiPort = process.env.CONTROL_API_PORT ?? '3000';
const gameServerPort = process.env.GAME_SERVER_PORT ?? '2567';
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === 'true';
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: process.env.CI === 'true',
  retries: process.env.CI === 'true' ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
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
            reuseExistingServer: process.env.CI !== 'true',
            timeout: 120_000,
          },
          {
            command: 'pnpm --filter @web-legend/admin-web dev',
            url: `http://127.0.0.1:${adminWebPort}`,
            reuseExistingServer: process.env.CI !== 'true',
            timeout: 120_000,
          },
          {
            // Migrations and the default realm are idempotent prerequisites for
            // real registration and character creation.
            command: 'pnpm db:migrate && pnpm db:seed && pnpm --filter @web-legend/control-api dev',
            url: `http://127.0.0.1:${controlApiPort}/health/live`,
            reuseExistingServer: process.env.CI !== 'true',
            timeout: 180_000,
          },
          {
            command: 'pnpm --filter @web-legend/game-server dev',
            url: `http://127.0.0.1:${gameServerPort}/health/live`,
            reuseExistingServer: process.env.CI !== 'true',
            timeout: 120_000,
          },
        ],
      }),
});
