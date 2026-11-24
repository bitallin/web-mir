import { randomUUID } from 'node:crypto';

import {
  apiErrorSchema,
  authResponseSchema,
  characterResponseSchema,
  charactersResponseSchema,
  gameTicketResponseSchema,
  type AuthResponse,
  type CharacterResponse,
} from '@web-legend/contracts';
import { hashToken } from '@web-legend/auth';
import { createLogger } from '@web-legend/observability';
import {
  consumeGameTicket,
  createDatabase,
  findCharacterById,
  realms,
  type DatabaseHandle,
} from '@web-legend/persistence';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ControlApiEnv } from '../src/env';
import { buildServer } from '../src/server';

const databaseUrl = process.env.DATABASE_URL;

function requireDatabaseUrl(): string {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required for control API auth integration tests');
  }
  return databaseUrl;
}

const logger = createLogger({
  service: 'control-api',
  level: 'silent',
  destination: { write: () => undefined },
});

type CookieJar = {
  access: string | undefined;
  refresh: string | undefined;
};

function cookieHeader(jar: CookieJar): string {
  const parts: string[] = [];
  if (jar.access !== undefined && jar.access.length > 0) {
    parts.push(`wl_access=${jar.access}`);
  }
  if (jar.refresh !== undefined && jar.refresh.length > 0) {
    parts.push(`wl_refresh=${jar.refresh}`);
  }
  return parts.join('; ');
}

function responseCookies(response: { headers: Record<string, unknown> }): string[] {
  const header = response.headers['set-cookie'];
  if (header === undefined) {
    return [];
  }
  if (Array.isArray(header)) {
    return header.filter((item): item is string => typeof item === 'string');
  }
  return typeof header === 'string' ? [header] : [];
}

function applyCookies(jar: CookieJar, response: { headers: Record<string, unknown> }): void {
  for (const cookie of responseCookies(response)) {
    const pair = cookie.split(';')[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (name === 'wl_access') {
      jar.access = value;
    }
    if (name === 'wl_refresh') {
      jar.refresh = value;
    }
  }
}

function cloneJar(jar: CookieJar): CookieJar {
  return { access: jar.access, refresh: jar.refresh };
}

function uniqueUsername(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/gu, '').slice(0, 12)}`;
}

const PASSWORD = 'phase-two-password';

describe.runIf(databaseUrl !== undefined)('control API accounts, characters and tickets', () => {
  let database: DatabaseHandle;
  let app: Awaited<ReturnType<typeof buildServer>>;

  async function register(prefix = 'user'): Promise<{ jar: CookieJar; body: AuthResponse }> {
    const username = uniqueUsername(prefix);
    const jar: CookieJar = { access: undefined, refresh: undefined };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username, password: PASSWORD },
    });
    applyCookies(jar, response);
    expect(response.statusCode).toBe(201);
    return { jar, body: authResponseSchema.parse(response.json()) };
  }

  async function createCharacter(
    jar: CookieJar,
    name: string,
    classId: 'warrior' | 'mage' | 'taoist' = 'warrior',
  ): Promise<CharacterResponse> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/characters',
      headers: { cookie: cookieHeader(jar) },
      payload: { name, classId },
    });
    expect(response.statusCode).toBe(201);
    return characterResponseSchema.parse(response.json());
  }

  function uniqueCharacterName(prefix: string): string {
    return `${prefix}${randomUUID().replace(/-/gu, '').slice(0, 6)}`;
  }

  beforeAll(async () => {
    database = createDatabase(requireDatabaseUrl(), { max: 5 });
    await database.db
      .insert(realms)
      .values({ code: 'classic-01', name: '经典一区', status: 'active' })
      .onConflictDoNothing({ target: realms.code });

    const env: ControlApiEnv = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      CONTROL_API_HOST: '127.0.0.1',
      CONTROL_API_PORT: 3002,
      DATABASE_URL: requireDatabaseUrl(),
      CORS_ORIGINS: ['http://localhost:5173'],
    };

    app = await buildServer({
      env,
      logger,
      readiness: () => Promise.resolve([{ name: 'database', status: 'ok' }]),
      database: database.db,
      authRateLimit: { capacity: 1_000, refillPerSecond: 1_000 },
    });
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  it('registers an account, sets HttpOnly cookies and returns an empty roster', async () => {
    const username = uniqueUsername('alice');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username, password: PASSWORD },
    });

    expect(response.statusCode).toBe(201);
    const body = authResponseSchema.parse(response.json());
    expect(body.account.username).toBe(username);
    expect(body.characters).toEqual([]);

    const cookies = responseCookies(response);
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
    }
  });

  it('rejects a duplicate username regardless of case and never reveals it via login', async () => {
    const { body } = await register('dup');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: body.account.username.toUpperCase(), password: PASSWORD },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(apiErrorSchema.parse(duplicate.json()).error.code).toBe('ACCOUNT_EXISTS');

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: body.account.username, password: 'not-the-password' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(apiErrorSchema.parse(wrongPassword.json()).error.code).toBe('INVALID_CREDENTIALS');

    const unknownUser = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: uniqueUsername('ghost'), password: PASSWORD },
    });
    expect(unknownUser.statusCode).toBe(401);
    expect(apiErrorSchema.parse(unknownUser.json()).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('requires the access cookie for account and character endpoints', async () => {
    for (const request of [
      { method: 'GET' as const, url: '/api/v1/me' },
      { method: 'GET' as const, url: '/api/v1/characters' },
      {
        method: 'POST' as const,
        url: '/api/v1/game/ticket',
        payload: { characterId: randomUUID() },
      },
    ]) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(401);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('UNAUTHORIZED');
    }
  });

  it('rotates refresh tokens and rejects a replayed old refresh token', async () => {
    const { jar } = await register('rotate');
    const oldJar = cloneJar(jar);

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: cookieHeader(jar) },
    });
    expect(refreshed.statusCode).toBe(200);
    const newJar = cloneJar(jar);
    applyCookies(newJar, refreshed);
    expect(newJar.access).not.toBe(oldJar.access);
    expect(newJar.refresh).not.toBe(oldJar.refresh);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookieHeader(newJar) },
    });
    expect(me.statusCode).toBe(200);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: cookieHeader(oldJar) },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('revokes the session on logout', async () => {
    const { jar } = await register('logout');

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookieHeader(jar) },
    });
    expect(logout.statusCode).toBe(204);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookieHeader(jar) },
    });
    expect(me.statusCode).toBe(401);

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: cookieHeader(jar) },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it('rejects cross-origin writes and accepts same-origin writes', async () => {
    const crossOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example', host: '127.0.0.1:3002' },
      payload: { username: uniqueUsername('csrf'), password: PASSWORD },
    });
    expect(crossOrigin.statusCode).toBe(403);

    const sameOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://127.0.0.1:3002', host: '127.0.0.1:3002' },
      payload: { username: uniqueUsername('same'), password: PASSWORD },
    });
    expect(sameOrigin.statusCode).toBe(401);
  });

  it('creates realm-unique characters and enforces ownership', async () => {
    const alice = await register('alice');
    const name = uniqueCharacterName('烈焰');

    const created = await createCharacter(alice.jar, name);
    expect(created.character.name).toBe(name);
    expect(created.character.classId).toBe('warrior');
    expect(created.character.realmCode).toBe('classic-01');
    expect(created.character.hp).toBe(120);
    expect(created.character.mapId).toBe('starter_town');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/characters',
      headers: { cookie: cookieHeader(alice.jar) },
      payload: { name: name.toLowerCase(), classId: 'mage' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(apiErrorSchema.parse(duplicate.json()).error.code).toBe('CHARACTER_NAME_TAKEN');

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/characters',
      headers: { cookie: cookieHeader(alice.jar) },
      payload: { name: 'a', classId: 'assassin' },
    });
    expect(invalid.statusCode).toBe(422);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/characters',
      headers: { cookie: cookieHeader(alice.jar) },
    });
    const roster = charactersResponseSchema.parse(list.json());
    expect(roster.characters.map((item) => item.id)).toContain(created.character.id);

    const bob = await register('bob');
    const foreignRead = await app.inject({
      method: 'GET',
      url: `/api/v1/characters/${created.character.id}`,
      headers: { cookie: cookieHeader(bob.jar) },
    });
    expect(foreignRead.statusCode).toBe(404);

    const foreignTicket = await app.inject({
      method: 'POST',
      url: '/api/v1/game/ticket',
      headers: { cookie: cookieHeader(bob.jar) },
      payload: { characterId: created.character.id },
    });
    expect(foreignTicket.statusCode).toBe(404);
  });

  it('issues a short-lived ticket bound to the owned character', async () => {
    const alice = await register('ticket');
    const created = await createCharacter(alice.jar, uniqueCharacterName('游侠'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/game/ticket',
      headers: { cookie: cookieHeader(alice.jar) },
      payload: { characterId: created.character.id },
    });

    expect(response.statusCode).toBe(200);
    const ticket = gameTicketResponseSchema.parse(response.json());
    expect(ticket.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(ticket.character.id).toBe(created.character.id);
    expect(new Date(ticket.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(ticket.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 61_000);
  });

  it('consumes a ticket exactly once even under concurrent join attempts', async () => {
    const alice = await register('concurrent');
    const created = await createCharacter(alice.jar, uniqueCharacterName('疾风'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/game/ticket',
      headers: { cookie: cookieHeader(alice.jar) },
      payload: { characterId: created.character.id },
    });
    const ticket = gameTicketResponseSchema.parse(response.json());
    const now = new Date();

    const [first, second] = await Promise.all([
      consumeGameTicket(database.db, hashToken(ticket.ticket), 'server-a:session', now),
      consumeGameTicket(database.db, hashToken(ticket.ticket), 'server-b:session', now),
    ]);

    expect([first, second].filter((entry) => entry !== undefined)).toHaveLength(1);
    const winner = first ?? second;
    expect(winner?.characterId).toBe(created.character.id);
    expect(
      await consumeGameTicket(database.db, hashToken(ticket.ticket), 'server-c:session', now),
    ).toBeUndefined();
  });

  it('keeps characters readable after the API process restarts', async () => {
    const alice = await register('restart');
    const created = await createCharacter(alice.jar, uniqueCharacterName('守望'));

    await app.close();
    const env: ControlApiEnv = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      CONTROL_API_HOST: '127.0.0.1',
      CONTROL_API_PORT: 3002,
      DATABASE_URL: requireDatabaseUrl(),
      CORS_ORIGINS: ['http://localhost:5173'],
    };
    app = await buildServer({
      env,
      logger,
      readiness: () => Promise.resolve([{ name: 'database', status: 'ok' }]),
      database: database.db,
      authRateLimit: { capacity: 1_000, refillPerSecond: 1_000 },
    });

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookieHeader(alice.jar) },
    });
    expect(me.statusCode).toBe(200);
    const body = authResponseSchema.parse(me.json());
    expect(body.characters.map((item) => item.id)).toContain(created.character.id);

    const stored = await findCharacterById(database.db, created.character.id);
    expect(stored?.name).toBe(created.character.name);
  });

  it('rate limits repeated authentication attempts', async () => {
    const limitedApp = await buildServer({
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        CONTROL_API_HOST: '127.0.0.1',
        CONTROL_API_PORT: 3003,
        DATABASE_URL: requireDatabaseUrl(),
        CORS_ORIGINS: ['http://localhost:5173'],
      },
      logger,
      readiness: () => Promise.resolve([{ name: 'database', status: 'ok' }]),
      database: database.db,
      authRateLimit: { capacity: 2, refillPerSecond: 0.01 },
    });

    const attempt = () =>
      limitedApp.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: uniqueUsername('limit'), password: PASSWORD },
      });

    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(401);
    const throttled = await attempt();
    expect(throttled.statusCode).toBe(429);
    expect(apiErrorSchema.parse(throttled.json()).error.code).toBe('RATE_LIMITED');

    await limitedApp.close();
  });
});
