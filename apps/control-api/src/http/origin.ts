import type { FastifyReply, FastifyRequest } from 'fastify';

import { errorEnvelope } from './errors';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defense for cookie-authenticated writes. A browser request that sends
 * `Origin` must be same-origin with the API or explicitly allowlisted; requests
 * without `Origin` (CLI, tests, server-to-server) are not browser CSRF vectors.
 */
export function isOriginAllowed(
  origin: string,
  requestHost: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  if (requestHost === undefined || requestHost.length === 0) {
    return false;
  }
  try {
    const originUrl = new URL(origin);
    if (originUrl.host === requestHost) {
      return true;
    }
    // A reverse proxy (Vite in development, nginx in production) may present
    // the API on a different port of the same host. Cookies are not port
    // scoped, so same-hostname origins share the same CSRF surface.
    return originUrl.hostname === new URL(`http://${requestHost}`).hostname;
  } catch {
    return false;
  }
}

export function createOriginGuard(allowedOrigins: readonly string[]) {
  return async function originGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | undefined> {
    if (!STATE_CHANGING_METHODS.has(request.method)) {
      return undefined;
    }
    const origin = request.headers.origin;
    if (origin === undefined || isOriginAllowed(origin, request.headers.host, allowedOrigins)) {
      return undefined;
    }
    return reply
      .status(403)
      .send(errorEnvelope('FORBIDDEN', 'Request origin is not allowed', request.id));
  };
}
