import { describe, expect, it } from 'vitest';

import { isOriginAllowed } from '../src/http/origin';

describe('CSRF origin policy', () => {
  it('accepts the exact request origin', () => {
    expect(isOriginAllowed('http://127.0.0.1:84', '127.0.0.1:84', [])).toBe(true);
  });

  it('accepts the same hostname behind a port-remapping reverse proxy', () => {
    expect(isOriginAllowed('http://127.0.0.1:84', '127.0.0.1:86', [])).toBe(true);
    expect(isOriginAllowed('http://10.30.0.25:8584', '10.30.0.25:86', [])).toBe(true);
  });

  it('accepts explicitly allowlisted origins on another host', () => {
    expect(
      isOriginAllowed('https://play.example.com', 'api.internal:3000', [
        'https://play.example.com',
      ]),
    ).toBe(true);
  });

  it('rejects foreign hosts, schemes and malformed origins', () => {
    expect(isOriginAllowed('https://evil.example', 'game.example.com', [])).toBe(false);
    expect(isOriginAllowed('http://game.example.com.evil.example', 'game.example.com', [])).toBe(
      false,
    );
    expect(isOriginAllowed('not a url', 'game.example.com', [])).toBe(false);
    expect(isOriginAllowed('https://game.example.com', undefined, [])).toBe(false);
  });
});
