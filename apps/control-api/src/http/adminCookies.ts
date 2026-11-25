export const ADMIN_ACCESS_COOKIE = 'wl_admin_access';
export const ADMIN_COOKIE_PATH = '/api/v1/admin';
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

export const ADMIN_LOGIN_RATE_LIMIT = { capacity: 10, refillPerSecond: 0.02 } as const;
