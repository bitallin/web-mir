import {
  SESSION_POLICY,
  createSessionTokens,
  hashPassword,
  hashToken,
  verifyPassword,
  type IssuedSessionTokens,
} from '@web-legend/auth';
import { normalizeUsername, type LoginRequest, type RegisterRequest } from '@web-legend/contracts';
import {
  findAccountById,
  findAccountByNormalizedUsername,
  findSessionByAccessHash,
  findSessionByRefreshHash,
  insertAccount,
  insertSession,
  isUniqueViolation,
  revokeSession,
  revokeSessionByAccessHash,
  rotateSession,
  type Account,
  type Database,
} from '@web-legend/persistence';

import { AppError } from '../http/errors';

export type AuthSessionResult = {
  account: Account;
  tokens: IssuedSessionTokens;
};

/**
 * Account and session use cases. Tokens are opaque random values; only their
 * digests are persisted. Unknown usernames still run a password verification
 * so login timing does not reveal whether an account exists.
 */
export class AuthService {
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.dummyHash = hashPassword('web-legend-placeholder-password');
  }

  async register(input: RegisterRequest): Promise<AuthSessionResult> {
    const usernameNormalized = normalizeUsername(input.username);
    const passwordHash = await hashPassword(input.password);

    let account: Account;
    try {
      account = await insertAccount(this.db, {
        username: input.username,
        usernameNormalized,
        passwordHash,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'ACCOUNT_EXISTS', '该账号已被注册');
      }
      throw error;
    }

    const tokens = await this.createSession(account.id);
    return { account, tokens };
  }

  async login(input: LoginRequest): Promise<AuthSessionResult> {
    const usernameNormalized = normalizeUsername(input.username);
    const account = await findAccountByNormalizedUsername(this.db, usernameNormalized);

    if (account === undefined) {
      await verifyPassword(await this.dummyHash, input.password);
      throw new AppError(401, 'INVALID_CREDENTIALS', '账号或密码错误');
    }

    const passwordMatches = await verifyPassword(account.passwordHash, input.password);
    if (!passwordMatches) {
      throw new AppError(401, 'INVALID_CREDENTIALS', '账号或密码错误');
    }

    if (account.status !== 'active') {
      throw new AppError(403, 'FORBIDDEN', '该账号已被停用');
    }

    const tokens = await this.createSession(account.id);
    return { account, tokens };
  }

  /**
   * Rotates both tokens in place. The old refresh token stops working as soon
   * as the new digests are written.
   */
  async refresh(refreshToken: string): Promise<AuthSessionResult> {
    const now = this.now();
    const session = await findSessionByRefreshHash(this.db, hashToken(refreshToken), now);
    if (session === undefined) {
      throw new AppError(401, 'UNAUTHORIZED', '登录已过期，请重新登录');
    }

    const tokens = createSessionTokens(now.getTime(), SESSION_POLICY);
    const rotated = await rotateSession(
      this.db,
      session.id,
      {
        accessTokenHash: tokens.accessTokenHash,
        refreshTokenHash: tokens.refreshTokenHash,
        accessExpiresAt: tokens.accessExpiresAt,
        refreshExpiresAt: tokens.refreshExpiresAt,
      },
      now,
    );
    if (rotated === undefined) {
      throw new AppError(401, 'UNAUTHORIZED', '登录已过期，请重新登录');
    }

    const account = await this.findActiveAccount(session.accountId);
    return { account, tokens };
  }

  async authenticate(accessToken: string): Promise<Account> {
    const session = await findSessionByAccessHash(this.db, hashToken(accessToken), this.now());
    if (session === undefined) {
      throw new AppError(401, 'UNAUTHORIZED', '请先登录');
    }
    return this.findActiveAccount(session.accountId);
  }

  async logout(accessToken: string | undefined, refreshToken: string | undefined): Promise<void> {
    const now = this.now();
    if (accessToken !== undefined) {
      await revokeSessionByAccessHash(this.db, hashToken(accessToken), now);
    }
    if (refreshToken !== undefined) {
      const session = await findSessionByRefreshHash(this.db, hashToken(refreshToken), now);
      if (session !== undefined) {
        await revokeSession(this.db, session.id, now);
      }
    }
  }

  private async createSession(accountId: string): Promise<IssuedSessionTokens> {
    const tokens = createSessionTokens(this.now().getTime(), SESSION_POLICY);
    await insertSession(this.db, {
      accountId,
      accessTokenHash: tokens.accessTokenHash,
      refreshTokenHash: tokens.refreshTokenHash,
      accessExpiresAt: tokens.accessExpiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
    });
    return tokens;
  }

  private async findActiveAccount(accountId: string): Promise<Account> {
    const account = await findAccountById(this.db, accountId);
    if (account === undefined) {
      throw new AppError(401, 'UNAUTHORIZED', '请先登录');
    }
    if (account.status !== 'active') {
      throw new AppError(403, 'FORBIDDEN', '该账号已被停用');
    }
    return account;
  }
}
