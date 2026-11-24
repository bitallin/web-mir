import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const envDir = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');
  const port = Number(env.GAME_WEB_PORT ?? 5173);
  const controlApiUrl = `http://127.0.0.1:${env.CONTROL_API_PORT ?? '3000'}`;
  const gameServerUrl = `http://127.0.0.1:${env.GAME_SERVER_PORT ?? '2567'}`;

  return {
    envDir,
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port,
      strictPort: true,
      watch: {
        usePolling: true,
        interval: 500,
      },
      proxy: {
        '/api': controlApiUrl,
        '/health': controlApiUrl,
        // Same-origin realtime endpoint: matchmaking HTTP and the WebSocket
        // upgrade both go through Vite in development and a reverse proxy in
        // production, so the browser never needs the game server's port.
        '/ws': {
          target: gameServerUrl,
          ws: true,
          rewrite: (path) => path.replace(/^\/ws/, ''),
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      strictPort: true,
    },
    build: {
      target: 'es2022',
      sourcemap: true,
    },
  };
});
