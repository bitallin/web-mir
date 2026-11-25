import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';

import { Client } from '@colyseus/sdk';
import { BASE_CONTENT_BUNDLE, contentChecksum } from '@web-legend/content-schema';
import {
  CONTENT_SCHEMA_VERSION,
  PROTOCOL_VERSION,
  TILE_UNITS,
  worldRoomNameFor,
  type ContentBundle,
} from '@web-legend/contracts';
import { STARTER_TOWN_MAP } from '@web-legend/contracts/maps';
import { createLogger } from '@web-legend/observability';
import {
  activateContentRelease,
  createDatabase,
  insertAccount,
  insertCharacter,
  insertContentRelease,
  realms,
  type DatabaseHandle,
} from '@web-legend/persistence';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { GameServerEnv } from '../src/env';
import { createGameServer, type GameServerRuntime } from '../src/server';
import { ContentStore } from '../src/world/contentStore';
import { ensureTestRealm, issueTicket } from './worldTestHelpers';

async function reservePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('failed to reserve a TCP port'));
        return;
      }
      const { port } = address;
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function releasedBundle(name: string): ContentBundle {
  const bundle = structuredClone(BASE_CONTENT_BUNDLE);
  bundle.monsters['wild_slime']!.name = name;
  return bundle;
}

describe('realm binding and per-realm content', () => {
  let runtime: GameServerRuntime;
  let database: DatabaseHandle;
  let baseUrl: string;
  const suffix = randomUUID().replace(/-/gu, '').slice(0, 8);
  const otherRealmCode = `other-${suffix}`;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) {
      throw new Error('DATABASE_URL is required for deployment integration tests');
    }
    database = createDatabase(databaseUrl, { max: 4 });
    await ensureTestRealm(database.db);
    const port = await reservePort();
    const env: GameServerEnv = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      GAME_SERVER_HOST: '127.0.0.1',
      GAME_SERVER_PORT: port,
      DATABASE_URL: databaseUrl,
      GAME_SERVER_ID: 'game-server-deployment-test',
      GAME_SERVER_REALM: 'classic-01',
      INTERNAL_ADMIN_TOKEN: 'test-internal-admin-token-123',
    };
    runtime = createGameServer({
      env,
      logger: createLogger({
        service: 'game-server',
        level: 'silent',
        destination: { write: () => undefined },
      }),
      database: database.db,
    });
    await runtime.listen();
    baseUrl = `http://127.0.0.1:${String(port)}`;
  });

  afterAll(async () => {
    await runtime?.shutdown();
    await database?.close();
  });

  it('rejects a character from another realm', async () => {
    const [otherRealm] = await database.db
      .insert(realms)
      .values({ code: otherRealmCode, name: '其它区服', status: 'active' })
      .returning();
    if (otherRealm === undefined) {
      throw new Error('failed to create test realm');
    }

    const account = await insertAccount(database.db, {
      username: `realm_${suffix}`.slice(0, 24),
      usernameNormalized: `realm_${suffix}`.slice(0, 24),
      passwordHash: 'test-only-password-hash',
    });
    const spawn = STARTER_TOWN_MAP.spawnPoints[0];
    if (spawn === undefined) {
      throw new Error('starter town has no spawn point');
    }
    const character = await insertCharacter(database.db, {
      accountId: account.id,
      realmId: otherRealm.id,
      name: `R${suffix}`.slice(0, 12),
      nameNormalized: `r${suffix}`.slice(0, 12),
      classId: 'warrior',
      level: 1,
      exp: 0,
      hp: 120,
      maxHp: 120,
      mp: 30,
      maxMp: 30,
      mapId: STARTER_TOWN_MAP.mapId,
      x: spawn.x * TILE_UNITS + TILE_UNITS / 2,
      y: spawn.y * TILE_UNITS + TILE_UNITS / 2,
      facing: 2,
    });
    const ticket = await issueTicket(database.db, { accountId: account.id, character });

    const client = new Client(baseUrl);
    await expect(
      client.create(worldRoomNameFor(STARTER_TOWN_MAP.mapId), {
        protocolVersion: PROTOCOL_VERSION,
        ticket,
      }),
    ).rejects.toMatchObject({ code: 525 });
  });

  it('loads the release activated for the bound realm', async () => {
    const [other] = await database.db
      .select()
      .from(realms)
      .where(eq(realms.code, otherRealmCode))
      .limit(1);
    if (other === undefined) {
      throw new Error('other realm is missing');
    }

    const otherBundle = releasedBundle(`其它史莱姆-${suffix}`);
    const release = await insertContentRelease(database.db, {
      version: `test-other-${suffix}`,
      schemaVersion: CONTENT_SCHEMA_VERSION,
      checksum: contentChecksum(otherBundle),
      payload: otherBundle,
      changeSummary: {},
      createdBy: null,
      createdByUsername: 'test',
      note: null,
      createdAt: new Date(),
    });
    await activateContentRelease(database.db, {
      realmId: other.id,
      releaseId: release.id,
      adminUserId: null,
      adminUsername: 'test',
      reason: 'deployment integration test',
      now: new Date(),
    });

    const store = new ContentStore(
      database.db,
      createLogger({ service: 'test', level: 'silent' }),
      { realmCode: otherRealmCode },
    );
    await store.start();
    const snapshot = store.snapshot();
    store.stop();

    expect(snapshot.version).toBe(release.version);
    expect(snapshot.bundle.monsters['wild_slime']?.name).toBe(
      otherBundle.monsters['wild_slime']?.name,
    );
    expect(snapshot.checksum).toBe(release.checksum);
  });
});
