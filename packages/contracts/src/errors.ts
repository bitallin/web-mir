import { z } from 'zod';

export const apiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'INTERNAL_ERROR',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'ACCOUNT_EXISTS',
  'INVALID_CREDENTIALS',
  'CHARACTER_NAME_TAKEN',
  'CHARACTER_LIMIT_REACHED',
  'REALM_NOT_FOUND',
]);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    requestId: z.string().min(1),
    details: z.array(z.string().min(1)).optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
