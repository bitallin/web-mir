import {
  databaseUrlSchema,
  hostSchema,
  loadEnv,
  logLevelSchema,
  nodeEnvSchema,
  portSchema,
} from '@web-legend/config';
import { z } from 'zod';

export const DEV_INTERNAL_ADMIN_TOKEN = 'dev-only-internal-admin-token' as const;

export const gameServerEnvSchema = z
  .object({
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
    /** Shared secret for the Control API's internal command/status endpoints. */
    INTERNAL_ADMIN_TOKEN: z.string().min(16).max(128).default(DEV_INTERNAL_ADMIN_TOKEN),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.INTERNAL_ADMIN_TOKEN === DEV_INTERNAL_ADMIN_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['INTERNAL_ADMIN_TOKEN'],
        message: 'must be changed for production',
      });
    }
  });

export type GameServerEnv = z.infer<typeof gameServerEnvSchema>;

export function loadGameServerEnv(): GameServerEnv {
  return loadEnv(gameServerEnvSchema);
}
