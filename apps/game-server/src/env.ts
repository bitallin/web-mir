import {
  corsOriginsSchema,
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
    /** Realm this process serves; rooms reject characters from other realms. */
    GAME_SERVER_REALM: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,31}$/u)
      .default('classic-01'),
    /** Browser origins allowed to open a WebSocket; production requires a list. */
    GAME_SERVER_ALLOWED_ORIGINS: corsOriginsSchema.optional(),
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
    if (
      env.NODE_ENV === 'production' &&
      (env.GAME_SERVER_ALLOWED_ORIGINS === undefined ||
        env.GAME_SERVER_ALLOWED_ORIGINS.length === 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['GAME_SERVER_ALLOWED_ORIGINS'],
        message: 'must list at least one browser origin in production',
      });
    }
  });

export type GameServerEnv = z.infer<typeof gameServerEnvSchema>;

export function loadGameServerEnv(): GameServerEnv {
  return loadEnv(gameServerEnvSchema);
}
