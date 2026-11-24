import { createLogger } from '@web-legend/observability';
import { createDatabase } from '@web-legend/persistence';

import { loadControlApiEnv } from './env';
import { createDatabaseProbe } from './readiness';
import { buildServer } from './server';

async function main(): Promise<void> {
  const env = loadControlApiEnv();
  const logger = createLogger({
    service: 'control-api',
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV === 'development',
  });

  const database = createDatabase(env.DATABASE_URL, { max: 10 });
  const app = await buildServer({
    env,
    logger,
    readiness: createDatabaseProbe(database.db),
  });

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'control api shutting down');

    try {
      await app.close();
      await database.close();
      logger.info('control api stopped');
    } catch (error) {
      logger.error({ err: error }, 'control api shutdown failed');
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
    await app.listen({ host: env.CONTROL_API_HOST, port: env.CONTROL_API_PORT });
    logger.info(
      { host: env.CONTROL_API_HOST, port: env.CONTROL_API_PORT },
      'control api listening',
    );
  } catch (error) {
    logger.error({ err: error }, 'control api failed to start');
    await database.close();
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`control-api failed to start: ${message}\n`);
  process.exitCode = 1;
});
