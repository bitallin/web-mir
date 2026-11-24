import { createLogger } from '@web-legend/observability';

import { loadGameServerEnv } from './env';
import { createGameServer } from './server';

async function main(): Promise<void> {
  const env = loadGameServerEnv();
  const logger = createLogger({
    service: 'game-server',
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV === 'development',
  });

  const runtime = createGameServer({ env, logger });
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'game server shutting down');

    try {
      await runtime.shutdown();
      logger.info('game server stopped');
    } catch (error) {
      logger.error({ err: error }, 'game server shutdown failed');
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    await runtime.listen();
    logger.info(
      { host: env.GAME_SERVER_HOST, port: env.GAME_SERVER_PORT },
      'game server listening',
    );
  } catch (error) {
    logger.error({ err: error }, 'game server failed to start');
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`game-server failed to start: ${message}\n`);
  process.exitCode = 1;
});
