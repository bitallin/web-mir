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

export const controlApiEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  CONTROL_API_HOST: hostSchema,
  CONTROL_API_PORT: portSchema.default(3000),
  DATABASE_URL: databaseUrlSchema,
  CORS_ORIGINS: corsOriginsSchema,
});

export type ControlApiEnv = z.infer<typeof controlApiEnvSchema>;

export function loadControlApiEnv(): ControlApiEnv {
  return loadEnv(controlApiEnvSchema);
}
