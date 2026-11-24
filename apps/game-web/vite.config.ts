import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const envDir = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');
  const port = Number(env.GAME_WEB_PORT ?? 5173);
  const controlApiUrl = `http://127.0.0.1:${env.CONTROL_API_PORT ?? '3000'}`;

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
