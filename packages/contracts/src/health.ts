import { z } from 'zod';

import { SERVICE_NAMES } from './protocol';

export const serviceNameSchema = z.enum(SERVICE_NAMES);
export type HealthServiceName = z.infer<typeof serviceNameSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: serviceNameSchema,
  version: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessCheckSchema = z.object({
  name: z.string().min(1),
  status: z.enum(['ok', 'error']),
  detail: z.string().min(1).optional(),
});

export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;

export const readinessResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: serviceNameSchema,
  version: z.string().min(1),
  checks: z.array(readinessCheckSchema).min(1),
  timestamp: z.iso.datetime(),
});

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
