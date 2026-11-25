import { SESSION_POLICY, type IssuedSessionTokens } from '@web-legend/auth';
import {
  roleHasPermission,
  type AdminPermission,
  type AuthResponse,
  type AccountView,
  type CharacterView,
} from '@web-legend/contracts';
import { authResponseSchema } from '@web-legend/contracts';
import type { Account, AdminUser, CharacterWithRealm } from '@web-legend/persistence';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import type { Logger } from 'pino';
import type { ZodType } from 'zod';

import {
  ADMIN_ACCESS_COOKIE,
  ADMIN_COOKIE_PATH,
  ADMIN_SESSION_TTL_SECONDS,
} from '../http/adminCookies';
import {
  ACCESS_COOKIE,
  ACCESS_COOKIE_PATH,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  clearCookie,
  readCookie,
  serializeCookie,
} from '../http/cookies';
import { AppError } from '../http/errors';
import type { AdminService } from '../services/admin';
import type { AdminAuthService } from '../services/adminAuth';
import type { AuthService } from '../services/auth';
import type { CharacterService } from '../services/characters';
import type { ContentService } from '../services/content';
import type { TicketService } from '../services/tickets';
import { toAccountView, toCharacterView } from '../services/views';

export type AppServer = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  Logger
>;

export type RouteDependencies = {
  auth: AuthService;
  characters: CharacterService;
  tickets: TicketService;
  adminAuth: AdminAuthService;
  admin: AdminService;
  content: ContentService;
  rateLimit: (key: string) => boolean;
  adminRateLimit: (key: string) => boolean;
  secureCookies: boolean;
};

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? '请求参数不合法';
    throw new AppError(422, 'VALIDATION_ERROR', message);
  }
  return parsed.data;
}

export function enforceAuthRateLimit(
  dependencies: RouteDependencies,
  request: FastifyRequest,
  bucket: string,
): void {
  if (!dependencies.rateLimit(`${request.ip}:${bucket}`)) {
    throw new AppError(429, 'RATE_LIMITED', '操作过于频繁，请稍后再试');
  }
}

export async function requireSession(
  dependencies: RouteDependencies,
  request: FastifyRequest,
): Promise<{ account: Account; accessToken: string }> {
  const accessToken = readCookie(request.headers.cookie, ACCESS_COOKIE);
  if (accessToken === undefined) {
    throw new AppError(401, 'UNAUTHORIZED', '请先登录');
  }
  const account = await dependencies.auth.authenticate(accessToken);
  return { account, accessToken };
}

export function setSessionCookies(
  reply: FastifyReply,
  tokens: IssuedSessionTokens,
  secure: boolean,
): void {
  reply.header('Set-Cookie', [
    serializeCookie(ACCESS_COOKIE, tokens.accessToken, {
      path: ACCESS_COOKIE_PATH,
      maxAgeSeconds: SESSION_POLICY.accessTtlSeconds,
      secure,
    }),
    serializeCookie(REFRESH_COOKIE, tokens.refreshToken, {
      path: REFRESH_COOKIE_PATH,
      maxAgeSeconds: SESSION_POLICY.refreshTtlSeconds,
      secure,
    }),
  ]);
}

export function clearSessionCookies(reply: FastifyReply, secure: boolean): void {
  reply.header('Set-Cookie', [
    clearCookie(ACCESS_COOKIE, {
      path: ACCESS_COOKIE_PATH,
      maxAgeSeconds: 0,
      secure,
    }),
    clearCookie(REFRESH_COOKIE, {
      path: REFRESH_COOKIE_PATH,
      maxAgeSeconds: 0,
      secure,
    }),
  ]);
}

export function accountAuthResponse(
  account: Account,
  characters: CharacterWithRealm[],
): AuthResponse {
  const accountView: AccountView = toAccountView(account);
  const characterViews: CharacterView[] = characters.map(toCharacterView);
  return authResponseSchema.parse({ account: accountView, characters: characterViews });
}

export async function requireAdmin(
  dependencies: RouteDependencies,
  request: FastifyRequest,
): Promise<{ admin: AdminUser; token: string }> {
  const token = readCookie(request.headers.cookie, ADMIN_ACCESS_COOKIE);
  if (token === undefined) {
    throw new AppError(401, 'UNAUTHORIZED', '请先登录管理后台');
  }
  const admin = await dependencies.adminAuth.authenticate(token);
  return { admin, token };
}

export function assertAdminPermission(admin: AdminUser, permission: AdminPermission): void {
  if (!roleHasPermission(admin.role, permission)) {
    throw new AppError(403, 'FORBIDDEN', '没有访问该后台功能的权限');
  }
}

export function setAdminCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.header(
    'Set-Cookie',
    serializeCookie(ADMIN_ACCESS_COOKIE, token, {
      path: ADMIN_COOKIE_PATH,
      maxAgeSeconds: ADMIN_SESSION_TTL_SECONDS,
      secure,
    }),
  );
}

export function clearAdminCookie(reply: FastifyReply, secure: boolean): void {
  reply.header(
    'Set-Cookie',
    clearCookie(ADMIN_ACCESS_COOKIE, {
      path: ADMIN_COOKIE_PATH,
      maxAgeSeconds: 0,
      secure,
    }),
  );
}

export function enforceAdminLoginRateLimit(
  dependencies: RouteDependencies,
  request: FastifyRequest,
): void {
  if (!dependencies.adminRateLimit(`${request.ip}:admin-login`)) {
    throw new AppError(429, 'RATE_LIMITED', '登录尝试过于频繁，请稍后再试');
  }
}

export function requireUuid(value: string | undefined, label: string): string {
  if (
    value === undefined ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)
  ) {
    throw new AppError(422, 'VALIDATION_ERROR', `${label} 不合法`);
  }
  return value;
}

export function reasonFromBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('reason' in body)) {
    return null;
  }
  const reason = body.reason;
  return typeof reason === 'string' ? reason.slice(0, 200) : null;
}
