export const ACCESS_COOKIE = 'wl_access';
export const REFRESH_COOKIE = 'wl_refresh';
export const ACCESS_COOKIE_PATH = '/';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export type CookieOptions = {
  path: string;
  maxAgeSeconds: number;
  secure: boolean;
};

export function parseCookies(header: string | undefined): Record<string, string> {
  if (header === undefined) {
    return {};
  }

  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    if (name.length === 0) {
      continue;
    }
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  return parseCookies(header)[name];
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${String(options.maxAgeSeconds)}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (options.secure) {
    attributes.push('Secure');
  }
  return attributes.join('; ');
}

export function clearCookie(name: string, options: CookieOptions): string {
  return serializeCookie(name, '', { ...options, maxAgeSeconds: 0 });
}
