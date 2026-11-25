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

export const controlApiEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: logLevelSchema,
    CONTROL_API_HOST: hostSchema,
    CONTROL_API_PORT: portSchema.default(3000),
    DATABASE_URL: databaseUrlSchema,
    CORS_ORIGINS: corsOriginsSchema,
    /** Used to derive the internal game-server URL when no explicit URL is set. */
    GAME_SERVER_PORT: portSchema.optional(),
    GAME_SERVER_INTERNAL_URL: z
      .string()
      .regex(/^https?:\/\/\S+$/u, 'must be an http(s) URL')
      .optional(),
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

export type ControlApiEnv = z.infer<typeof controlApiEnvSchema>;

export function loadControlApiEnv(): ControlApiEnv {
  return loadEnv(controlApiEnvSchema);
}

export function gameServerInternalUrl(env: ControlApiEnv): string {
  return env.GAME_SERVER_INTERNAL_URL ?? `http://127.0.0.1:${String(env.GAME_SERVER_PORT ?? 2567)}`;
}
