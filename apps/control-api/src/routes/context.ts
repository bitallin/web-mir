import { SESSION_POLICY, type IssuedSessionTokens } from '@web-legend/auth';
import type { AuthResponse, AccountView, CharacterView } from '@web-legend/contracts';
import { authResponseSchema } from '@web-legend/contracts';
import type { Account, CharacterWithRealm } from '@web-legend/persistence';
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
  ACCESS_COOKIE,
  ACCESS_COOKIE_PATH,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  clearCookie,
  readCookie,
  serializeCookie,
} from '../http/cookies';
import { AppError } from '../http/errors';
import type { AuthService } from '../services/auth';
import type { CharacterService } from '../services/characters';
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
  rateLimit: (key: string) => boolean;
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
