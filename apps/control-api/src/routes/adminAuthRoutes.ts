import {
  API_PREFIX,
  adminAuthResponseSchema,
  adminLoginRequestSchema,
} from '@web-legend/contracts';

import { ADMIN_ACCESS_COOKIE } from '../http/adminCookies';
import { readCookie } from '../http/cookies';
import { toAdminView } from '../services/adminViews';
import {
  clearAdminCookie,
  enforceAdminLoginRateLimit,
  parseBody,
  requireAdmin,
  setAdminCookie,
  type AppServer,
  type RouteDependencies,
} from './context';

export function registerAdminAuthRoutes(app: AppServer, dependencies: RouteDependencies): void {
  app.post(`${API_PREFIX}/admin/auth/login`, async (request, reply) => {
    enforceAdminLoginRateLimit(dependencies, request);
    const body = parseBody(adminLoginRequestSchema, request.body);
    const result = await dependencies.adminAuth.login(body);
    setAdminCookie(reply, result.token, dependencies.secureCookies);
    return reply.send(adminAuthResponseSchema.parse({ admin: toAdminView(result.admin) }));
  });

  app.get(`${API_PREFIX}/admin/auth/me`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    return reply.send(adminAuthResponseSchema.parse({ admin: toAdminView(admin) }));
  });

  app.post(`${API_PREFIX}/admin/auth/logout`, async (request, reply) => {
    const token = readCookie(request.headers.cookie, ADMIN_ACCESS_COOKIE);
    await dependencies.adminAuth.logout(token);
    clearAdminCookie(reply, dependencies.secureCookies);
    return reply.status(204).send();
  });
}
