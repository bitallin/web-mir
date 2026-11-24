import { describe, expect, it } from 'vitest';

import { clearCookie, parseCookies, readCookie, serializeCookie } from '../src/http/cookies';

describe('cookie helpers', () => {
  it('parses multiple cookies and URL-encoded values', () => {
    const cookies = parseCookies('wl_access=abc%3D%3D; wl_refresh=xyz; other=1');

    expect(cookies).toEqual({ wl_access: 'abc==', wl_refresh: 'xyz', other: '1' });
    expect(readCookie('a=1; b=2', 'b')).toBe('2');
    expect(readCookie(undefined, 'a')).toBeUndefined();
  });

  it('ignores malformed segments without throwing', () => {
    expect(parseCookies('broken; =empty; ok=1')).toEqual({ ok: '1' });
    expect(parseCookies('%E0%A4%A=value')).toEqual({ '%E0%A4%A': 'value' });
  });

  it('marks session cookies HttpOnly with a path and SameSite', () => {
    const cookie = serializeCookie('wl_access', 'token', {
      path: '/',
      maxAgeSeconds: 900,
      secure: false,
    });

    expect(cookie).toContain('wl_access=token');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=900');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
  });

  it('adds Secure in production and clears with Max-Age zero', () => {
    expect(
      serializeCookie('wl_refresh', 'token', {
        path: '/api/v1/auth',
        maxAgeSeconds: 60,
        secure: true,
      }),
    ).toContain('Secure');

    const cleared = clearCookie('wl_access', { path: '/', maxAgeSeconds: 0, secure: true });
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('wl_access=');
  });
});
