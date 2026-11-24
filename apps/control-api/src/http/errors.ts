import { apiErrorSchema, type ApiError, type ApiErrorCode } from '@web-legend/contracts';

/** Expected application failure; the HTTP error handler renders it verbatim. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorEnvelope(code: ApiErrorCode, message: string, requestId: string): ApiError {
  return apiErrorSchema.parse({ error: { code, message, requestId } });
}

export function codeForStatus(statusCode: number): ApiErrorCode {
  switch (statusCode) {
    case 400:
    case 422:
      return 'VALIDATION_ERROR';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'VALIDATION_ERROR';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return statusCode >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR';
  }
}
