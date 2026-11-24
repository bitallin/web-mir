import {
  API_PREFIX,
  loginRequestSchema,
  registerRequestSchema,
  realmsResponseSchema,
} from '@web-legend/contracts';
import { ACCESS_COOKIE, REFRESH_COOKIE, readCookie } from '../http/cookies';
import { AppError } from '../http/errors';
import { toRealmView } from '../services/views';
import {
  accountAuthResponse,
  clearSessionCookies,
  enforceAuthRateLimit,
  parseBody,
  requireSession,
  setSessionCookies,
  type AppServer,
  type RouteDependencies,
} from './context';

export function registerAuthRoutes(app: AppServer, dependencies: RouteDependencies): void {
  app.post(`${API_PREFIX}/auth/register`, async (request, reply) => {
    enforceAuthRateLimit(dependencies, request, 'register');
    const body = parseBody(registerRequestSchema, request.body);
    const result = await dependencies.auth.register(body);
    const characters = await dependencies.characters.list(result.account.id);
    setSessionCookies(reply, result.tokens, dependencies.secureCookies);
    return reply.status(201).send(accountAuthResponse(result.account, characters));
  });

  app.post(`${API_PREFIX}/auth/login`, async (request, reply) => {
    enforceAuthRateLimit(dependencies, request, 'login');
    const body = parseBody(loginRequestSchema, request.body);
    const result = await dependencies.auth.login(body);
    const characters = await dependencies.characters.list(result.account.id);
    setSessionCookies(reply, result.tokens, dependencies.secureCookies);
    return reply.send(accountAuthResponse(result.account, characters));
  });

  app.post(`${API_PREFIX}/auth/refresh`, async (request, reply) => {
    enforceAuthRateLimit(dependencies, request, 'refresh');
    const refreshToken = readCookie(request.headers.cookie, REFRESH_COOKIE);
    if (refreshToken === undefined) {
      throw new AppError(401, 'UNAUTHORIZED', '登录已过期，请重新登录');
    }

    const result = await dependencies.auth.refresh(refreshToken);
    const characters = await dependencies.characters.list(result.account.id);
    setSessionCookies(reply, result.tokens, dependencies.secureCookies);
    return reply.send(accountAuthResponse(result.account, characters));
  });

  app.post(`${API_PREFIX}/auth/logout`, async (request, reply) => {
    const accessToken = readCookie(request.headers.cookie, ACCESS_COOKIE);
    const refreshToken = readCookie(request.headers.cookie, REFRESH_COOKIE);
    await dependencies.auth.logout(accessToken, refreshToken);
    clearSessionCookies(reply, dependencies.secureCookies);
    return reply.status(204).send();
  });

  app.get(`${API_PREFIX}/me`, async (request, reply) => {
    const { account } = await requireSession(dependencies, request);
    const characters = await dependencies.characters.list(account.id);
    return reply.send(accountAuthResponse(account, characters));
  });

  app.get(`${API_PREFIX}/realms`, async (request, reply) => {
    await requireSession(dependencies, request);
    const realms = await dependencies.characters.listRealms();
    return reply.send(realmsResponseSchema.parse({ realms: realms.map(toRealmView) }));
  });
}
