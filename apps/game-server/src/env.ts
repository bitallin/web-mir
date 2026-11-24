import {
  databaseUrlSchema,
  hostSchema,
  loadEnv,
  logLevelSchema,
  nodeEnvSchema,
  portSchema,
} from '@web-legend/config';
import { z } from 'zod';

export const gameServerEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  GAME_SERVER_HOST: hostSchema,
  GAME_SERVER_PORT: portSchema.default(2567),
  DATABASE_URL: databaseUrlSchema,
  /** Identifies the process holding a character lease. */
  GAME_SERVER_ID: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,64}$/u)
    .default('game-server-local'),
});

export type GameServerEnv = z.infer<typeof gameServerEnvSchema>;

export function loadGameServerEnv(): GameServerEnv {
  return loadEnv(gameServerEnvSchema);
}
