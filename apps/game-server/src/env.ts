import { hostSchema, loadEnv, logLevelSchema, nodeEnvSchema, portSchema } from '@web-legend/config';
import { z } from 'zod';

export const gameServerEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  GAME_SERVER_HOST: hostSchema,
  GAME_SERVER_PORT: portSchema.default(2567),
});

export type GameServerEnv = z.infer<typeof gameServerEnvSchema>;

export function loadGameServerEnv(): GameServerEnv {
  return loadEnv(gameServerEnvSchema);
}
