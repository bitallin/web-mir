import { createOpaqueToken, hashPassword, hashToken, verifyPassword } from '@web-legend/auth';
import type { AdminLoginRequest } from '@web-legend/contracts';
import {
  findAdminByNormalizedUsername,
  findAdminSessionByTokenHash,
  insertAdminSession,
  revokeAdminSessionByTokenHash,
  touchAdminLogin,
  type AdminUser,
  type Database,
} from '@web-legend/persistence';

import { ADMIN_SESSION_TTL_SECONDS } from '../http/adminCookies';
import { AppError } from '../http/errors';

export type AdminLoginResult = {
  admin: AdminUser;
  token: string;
};

/**
 * Administrator authentication. Identities are separate from player accounts
 * and sessions never carry a refresh token: an expired console session simply
 * requires signing in again (ADR-022).
 */
export class AdminAuthService {
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.dummyHash = hashPassword('web-legend-admin-placeholder');
  }

  async login(input: AdminLoginRequest): Promise<AdminLoginResult> {
    const usernameNormalized = input.username.trim().toLowerCase();
    const admin = await findAdminByNormalizedUsername(this.db, usernameNormalized);
    if (admin === undefined) {
      await verifyPassword(await this.dummyHash, input.password);
      throw new AppError(401, 'INVALID_CREDENTIALS', '管理员账号或密码错误');
    }

    const matches = await verifyPassword(admin.passwordHash, input.password);
    if (!matches) {
      throw new AppError(401, 'INVALID_CREDENTIALS', '管理员账号或密码错误');
    }
    if (admin.status !== 'active') {
      throw new AppError(403, 'FORBIDDEN', '该管理员账号已停用');
    }

    const now = this.now();
    const token = createOpaqueToken();
    await insertAdminSession(this.db, {
      adminUserId: admin.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + ADMIN_SESSION_TTL_SECONDS * 1_000),
    });
    await touchAdminLogin(this.db, admin.id, now);
    return { admin: { ...admin, lastLoginAt: now }, token };
  }

  async authenticate(token: string): Promise<AdminUser> {
    const now = this.now();
    const active = await findAdminSessionByTokenHash(this.db, hashToken(token), now);
    if (active === undefined) {
      throw new AppError(401, 'UNAUTHORIZED', '管理员登录已过期，请重新登录');
    }
    if (active.admin.status !== 'active') {
      throw new AppError(403, 'FORBIDDEN', '该管理员账号已停用');
    }
    return active.admin;
  }

  async logout(token: string | undefined): Promise<void> {
    if (token === undefined) {
      return;
    }
    await revokeAdminSessionByTokenHash(this.db, hashToken(token), this.now());
  }
}
