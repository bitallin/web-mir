import { randomUUID } from 'node:crypto';

import {
  adminActionResultSchema,
  adminAuthResponseSchema,
  adminContentDraftDetailSchema,
  adminContentPublishResponseSchema,
  adminContentStateSchema,
  adminDashboardSchema,
  adminPlayerDetailSchema,
  adminPlayersResponseSchema,
  adminRoomsResponseSchema,
  characterResponseSchema,
  contentValidationReportSchema,
  type AdminCommandEnvelope,
  type AdminGameServerStatus,
  type AdminView,
} from '@web-legend/contracts';
import { hashPassword } from '@web-legend/auth';
import { createLogger } from '@web-legend/observability';
import {
  adminAuditLogs,
  contentReleases,
  createDatabase,
  insertAdminUser,
  itemInstances,
  outboxEvents,
  realms,
  type DatabaseHandle,
} from '@web-legend/persistence';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ControlApiEnv } from '../src/env';
import { buildServer } from '../src/server';
import type { GameServerGateway } from '../src/services/gameServerClient';

const databaseUrl = process.env.DATABASE_URL;

function requireDatabaseUrl(): string {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required for admin integration tests');
  }
  return databaseUrl;
}

const logger = createLogger({
  service: 'control-api',
  level: 'silent',
  destination: { write: () => undefined },
});

const ADMIN_PASSWORD = 'phase-seven-admin-password';

type CookieJar = { admin: string | undefined };

function cookieHeader(jar: CookieJar): string {
  return jar.admin === undefined ? '' : `wl_admin_access=${jar.admin}`;
}

function setCookieHeaders(headers: unknown): string[] {
  if (typeof headers !== 'object' || headers === null) {
    return [];
  }
  const header = (headers as Record<string, unknown>)['set-cookie'];
  if (Array.isArray(header)) {
    return header.filter((value): value is string => typeof value === 'string');
  }
  return typeof header === 'string' ? [header] : [];
}

function applyCookies(jar: CookieJar, response: { headers: unknown }): void {
  const values = setCookieHeaders(response.headers);
  for (const value of values) {
    const pair = value.split(';')[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    if (pair.slice(0, separator) === 'wl_admin_access') {
      jar.admin = pair.slice(separator + 1);
    }
  }
}

function uniqueSuffix(): string {
  return randomUUID().replace(/-/gu, '').slice(0, 10);
}

function fakeGameServer(): {
  gateway: GameServerGateway;
  commands: AdminCommandEnvelope[];
} {
  const commands: AdminCommandEnvelope[] = [];
  const status: AdminGameServerStatus = {
    service: 'game-server',
    serverId: 'game-server-test',
    realm: 'classic-01',
    uptimeSeconds: 120,
    rooms: [
      {
        roomId: 'room-alpha',
        mapId: 'starter_town',
        instanceId: '1',
        players: 3,
        tickP50Ms: 0.2,
        tickP95Ms: 0.9,
        tickP99Ms: 1.4,
        contentVersion: 'baseline',
        contentChecksum: 'a'.repeat(64),
      },
    ],
    totals: { rooms: 1, players: 3, activeCommands: 0 },
    timestamp: new Date().toISOString(),
  };
  return {
    commands,
    gateway: {
      status: () => Promise.resolve(status),
      dispatch: (command) => {
        commands.push(command);
        return Promise.resolve({
          status: 'applied' as const,
          applied: 1,
          timestamp: new Date().toISOString(),
        });
      },
    },
  };
}

describe.runIf(databaseUrl !== undefined)('admin console API', () => {
  let database: DatabaseHandle;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fake: ReturnType<typeof fakeGameServer>;
  const admins: Record<string, { username: string; view: AdminView; jar: CookieJar }> = {};

  async function createAdmin(
    key: string,
    role: 'super_admin' | 'ops_admin' | 'analyst' | 'content_designer' | 'release_approver',
  ): Promise<void> {
    const username = `adm_${key}_${uniqueSuffix()}`;
    await insertAdminUser(database.db, {
      username,
      usernameNormalized: username.toLowerCase(),
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      role,
    });
    const jar: CookieJar = { admin: undefined };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: { username, password: ADMIN_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    applyCookies(jar, response);
    const body = adminAuthResponseSchema.parse(response.json());
    admins[key] = { username, view: body.admin, jar };
  }

  async function createPlayer(prefix: string): Promise<{
    username: string;
    password: string;
    characterId: string;
    characterName: string;
  }> {
    const username = `pl_${prefix}_${uniqueSuffix()}`;
    const password = 'player-password-1';
    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username, password },
    });
    expect(register.statusCode).toBe(201);
    const accessCookie =
      setCookieHeaders(register.headers)
        .find((value) => value.startsWith('wl_access='))
        ?.split(';')[0] ?? '';
    const characterName = `A${uniqueSuffix()}`.slice(0, 12);
    const character = await app.inject({
      method: 'POST',
      url: '/api/v1/characters',
      headers: { cookie: accessCookie },
      payload: { name: characterName, classId: 'warrior' },
    });
    expect(character.statusCode).toBe(201);
    const parsed = characterResponseSchema.parse(character.json());
    return {
      username,
      password,
      characterId: parsed.character.id,
      characterName: parsed.character.name,
    };
  }

  function adminInject(
    key: string,
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<typeof app.inject>>> {
    return app.inject({
      method,
      url,
      headers: { cookie: cookieHeader(admins[key]?.jar ?? { admin: undefined }) },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  beforeAll(async () => {
    database = createDatabase(requireDatabaseUrl(), { max: 5 });
    await database.db
      .insert(realms)
      .values({ code: 'classic-01', name: '经典一区', status: 'active' })
      .onConflictDoNothing({ target: realms.code });

    fake = fakeGameServer();
    const env: ControlApiEnv = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      CONTROL_API_HOST: '127.0.0.1',
      CONTROL_API_PORT: 3000,
      DATABASE_URL: requireDatabaseUrl(),
      CORS_ORIGINS: ['http://localhost:5173'],
      INTERNAL_ADMIN_TOKEN: 'test-internal-admin-token-123',
    };
    app = await buildServer({
      env,
      logger,
      readiness: () => Promise.resolve([{ name: 'database', status: 'ok' as const }]),
      database: database.db,
      gameServerClient: fake.gateway,
    });

    await createAdmin('super', 'super_admin');
    await createAdmin('ops', 'ops_admin');
    await createAdmin('analyst', 'analyst');
    await createAdmin('designer', 'content_designer');
    await createAdmin('approver', 'release_approver');
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  it('requires authentication before serving admin data', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard' });
    expect(anonymous.statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/auth/login',
      payload: { username: admins['super']?.username ?? 'missing', password: 'wrong-password' },
    });
    expect(wrong.statusCode).toBe(401);

    const me = await adminInject('super', 'GET', '/api/v1/admin/auth/me');
    expect(me.statusCode).toBe(200);
    expect(adminAuthResponseSchema.parse(me.json()).admin.role).toBe('super_admin');

    const dashboard = await adminInject('super', 'GET', '/api/v1/admin/dashboard');
    expect(dashboard.statusCode).toBe(200);
    const body = adminDashboardSchema.parse(dashboard.json());
    expect(body.health.gameServer).toBe('ok');
    expect(body.metrics.onlinePlayers).toBe(3);
    expect(body.rooms).toHaveLength(1);

    const rooms = await adminInject('super', 'GET', '/api/v1/admin/rooms');
    expect(adminRoomsResponseSchema.parse(rooms.json()).status).toBe('ok');
  });

  it('searches players server-side and returns real character detail', async () => {
    const player = await createPlayer('search');
    const list = await adminInject(
      'super',
      'GET',
      `/api/v1/admin/players?query=${player.characterName}`,
    );
    expect(list.statusCode).toBe(200);
    const page = adminPlayersResponseSchema.parse(list.json());
    expect(page.total).toBe(1);
    expect(page.items[0]?.characterId).toBe(player.characterId);

    const detail = await adminInject('super', 'GET', `/api/v1/admin/players/${player.characterId}`);
    expect(detail.statusCode).toBe(200);
    const parsed = adminPlayerDetailSchema.parse(detail.json());
    expect(parsed.character.name).toBe(player.characterName);
    expect(parsed.inventory.some((item) => item.templateId === 'warrior_sword')).toBe(true);
    expect(parsed.wallet.balance).toBeGreaterThanOrEqual(0);
  });

  it('audits and queues kick, mute and ban with persisted account state', async () => {
    const target = await createPlayer('action');

    const kick = await adminInject(
      'ops',
      'POST',
      `/api/v1/admin/players/${target.characterId}/actions/kick`,
      { reason: '测试踢下线流程' },
    );
    expect(kick.statusCode).toBe(200);
    const kickBody = adminActionResultSchema.parse(kick.json());
    expect(kickBody.command.status).toBe('pending');
    expect(kickBody.command.type).toBe('kick');

    const [kickRow] = await database.db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.targetId, target.characterId), eq(outboxEvents.type, 'kick')))
      .orderBy(desc(outboxEvents.createdAt))
      .limit(1);
    expect(kickRow?.auditLogId).toBeTruthy();

    const [audit] = await database.db
      .select()
      .from(adminAuditLogs)
      .where(
        and(
          eq(adminAuditLogs.action, 'player.kick'),
          eq(adminAuditLogs.targetId, target.characterId),
        ),
      )
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(1);
    expect(audit?.result).toBe('success');
    expect(audit?.actorUsername).toBe(admins['ops']?.username);

    const shortReason = await adminInject(
      'ops',
      'POST',
      `/api/v1/admin/players/${target.characterId}/actions/kick`,
      { reason: 'x' },
    );
    expect(shortReason.statusCode).toBe(422);
    const [failedAudit] = await database.db
      .select()
      .from(adminAuditLogs)
      .where(and(eq(adminAuditLogs.action, 'player.kick'), eq(adminAuditLogs.result, 'failed')))
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(1);
    expect(failedAudit?.targetId).toBe(target.characterId);

    const mute = await adminInject(
      'ops',
      'POST',
      `/api/v1/admin/players/${target.characterId}/actions/mute`,
      { reason: '测试禁言流程', durationSeconds: 3600 },
    );
    expect(mute.statusCode).toBe(200);
    const [muteRow] = await database.db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.targetName, target.username), eq(outboxEvents.type, 'mute')))
      .orderBy(desc(outboxEvents.createdAt))
      .limit(1);
    expect(muteRow?.payload).toMatchObject({ durationSeconds: 3600 });

    const ban = await adminInject(
      'ops',
      'POST',
      `/api/v1/admin/players/${target.characterId}/actions/ban`,
      { reason: '测试封禁流程' },
    );
    expect(ban.statusCode).toBe(200);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: target.username, password: target.password },
    });
    expect(login.statusCode).toBe(403);
  });

  it('denies an analyst action and writes a failed audit row', async () => {
    const target = await createPlayer('rbac');
    const response = await adminInject(
      'analyst',
      'POST',
      `/api/v1/admin/players/${target.characterId}/actions/kick`,
      { reason: '越权尝试' },
    );
    expect(response.statusCode).toBe(403);

    const [audit] = await database.db
      .select()
      .from(adminAuditLogs)
      .where(
        and(
          eq(adminAuditLogs.action, 'player.kick'),
          eq(adminAuditLogs.result, 'failed'),
          eq(adminAuditLogs.targetId, target.characterId),
        ),
      )
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(1);
    expect(audit?.errorCode).toBe('FORBIDDEN');
    expect(audit?.actorUsername).toBe(admins['analyst']?.username);

    const list = await adminInject(
      'super',
      'GET',
      '/api/v1/admin/audit-logs?result=failed&pageSize=50',
    );
    expect(list.statusCode).toBe(200);
  });

  it('validates, publishes, activates and rolls back content releases', async () => {
    const draftResponse = await adminInject(
      'designer',
      'GET',
      '/api/v1/admin/content/drafts/items',
    );
    expect(draftResponse.statusCode).toBe(200);
    const draft = adminContentDraftDetailSchema.parse(draftResponse.json());
    const payload = draft.payload as Record<string, Record<string, unknown>>;
    const gel = payload['slime_gel'];
    expect(gel).toBeDefined();
    if (gel === undefined) {
      return;
    }
    const originalName = gel['name'];
    const renamed = `验收凝胶${uniqueSuffix().slice(0, 4)}`;

    const save = await adminInject('designer', 'PUT', '/api/v1/admin/content/drafts/items', {
      section: 'items',
      payload: { ...payload, slime_gel: { ...gel, name: renamed } },
      reason: '测试重命名材料',
    });
    expect(save.statusCode).toBe(200);

    const validation = await adminInject('designer', 'POST', '/api/v1/admin/content/validate', {});
    expect(validation.statusCode).toBe(200);
    const report = contentValidationReportSchema.parse(validation.json());
    expect(report.valid).toBe(true);
    expect(
      report.changes.some(
        (change) =>
          change.section === 'items' && change.id === 'slime_gel' && change.fields.includes('name'),
      ),
    ).toBe(true);

    const denied = await adminInject('designer', 'POST', '/api/v1/admin/content/releases', {
      reason: '越权发布',
    });
    expect(denied.statusCode).toBe(403);

    const published = await adminInject('approver', 'POST', '/api/v1/admin/content/releases', {
      reason: '测试发布内容',
      note: '阶段 7 集成测试',
    });
    expect(published.statusCode).toBe(201);
    const publishBody = adminContentPublishResponseSchema.parse(published.json());
    expect(publishBody.release.active).toBe(false);

    const before = adminContentStateSchema.parse(
      (await adminInject('approver', 'GET', '/api/v1/admin/content/state')).json(),
    );
    const previousId = before.activeRelease?.id ?? null;

    const activated = await adminInject('approver', 'POST', '/api/v1/admin/content/activate', {
      releaseId: publishBody.release.id,
      reason: '测试激活内容',
    });
    expect(activated.statusCode).toBe(200);

    const after = adminContentStateSchema.parse(
      (await adminInject('approver', 'GET', '/api/v1/admin/content/state')).json(),
    );
    expect(after.activeRelease?.id).toBe(publishBody.release.id);

    if (previousId !== null) {
      const rollback = await adminInject('approver', 'POST', '/api/v1/admin/content/activate', {
        releaseId: previousId,
        reason: '回滚到上一版本',
      });
      expect(rollback.statusCode).toBe(200);
    }

    await expect(
      database.db
        .update(contentReleases)
        .set({ note: '篡改' })
        .where(eq(contentReleases.id, publishBody.release.id)),
    ).rejects.toThrow();

    // Leave the draft semantically invalid, prove publish is blocked, then
    // restore the original section so later runs start clean.
    const lootResponse = await adminInject(
      'designer',
      'GET',
      '/api/v1/admin/content/drafts/lootTables',
    );
    const lootDraft = adminContentDraftDetailSchema.parse(lootResponse.json());
    const lootPayload = lootDraft.payload as Record<string, Record<string, unknown>>;
    const originalLoot = lootPayload;
    const slime = lootPayload['wild_slime'] as { entries: unknown[] } | undefined;
    if (slime === undefined) {
      return;
    }
    const brokenLoot = {
      ...lootPayload,
      wild_slime: {
        ...slime,
        entries: [
          ...slime.entries,
          { templateId: 'missing_item', chance: 1, minQuantity: 1, maxQuantity: 1 },
        ],
      },
    };
    const saveBroken = await adminInject(
      'designer',
      'PUT',
      '/api/v1/admin/content/drafts/lootTables',
      {
        section: 'lootTables',
        payload: brokenLoot,
        reason: '测试非法引用',
      },
    );
    expect(saveBroken.statusCode).toBe(200);

    const invalidReport = contentValidationReportSchema.parse(
      (await adminInject('designer', 'POST', '/api/v1/admin/content/validate', {})).json(),
    );
    expect(invalidReport.valid).toBe(false);

    const blocked = await adminInject('approver', 'POST', '/api/v1/admin/content/releases', {
      reason: '非法内容发布尝试',
    });
    expect(blocked.statusCode).toBe(422);

    await adminInject('designer', 'PUT', '/api/v1/admin/content/drafts/lootTables', {
      section: 'lootTables',
      payload: originalLoot,
      reason: '测试清理非法草稿',
    });
    await adminInject('designer', 'PUT', '/api/v1/admin/content/drafts/items', {
      section: 'items',
      payload: {
        ...payload,
        slime_gel: { ...gel, name: typeof originalName === 'string' ? originalName : '史莱姆凝胶' },
      },
      reason: '测试恢复物品名称',
    });
  });

  it('blocks a release that removes a template players still hold (TD-DATA-04)', async () => {
    const player = await createPlayer('cover');
    await database.db.insert(itemInstances).values({
      templateId: 'slime_gel',
      characterId: player.characterId,
      container: 'inventory',
      slotIndex: 20,
      quantity: 1,
    });

    const itemsDraft = adminContentDraftDetailSchema.parse(
      (await adminInject('designer', 'GET', '/api/v1/admin/content/drafts/items')).json(),
    );
    const itemsPayload = itemsDraft.payload as Record<string, unknown>;
    expect(itemsPayload['slime_gel']).toBeDefined();
    const withoutGel = { ...itemsPayload };
    delete withoutGel['slime_gel'];

    const lootDraft = adminContentDraftDetailSchema.parse(
      (await adminInject('designer', 'GET', '/api/v1/admin/content/drafts/lootTables')).json(),
    );
    const lootPayload = lootDraft.payload as Record<string, { entries: unknown[] }>;
    const withoutGelLoot = Object.fromEntries(
      Object.entries(lootPayload).map(([id, table]) => [
        id,
        {
          ...table,
          entries: table.entries.filter(
            (entry) => (entry as { templateId?: string }).templateId !== 'slime_gel',
          ),
        },
      ]),
    );

    expect(
      (
        await adminInject('designer', 'PUT', '/api/v1/admin/content/drafts/items', {
          section: 'items',
          payload: withoutGel,
          reason: '测试删除被持有物品模板',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await adminInject('designer', 'PUT', '/api/v1/admin/content/drafts/lootTables', {
          section: 'lootTables',
          payload: withoutGelLoot,
          reason: '测试移除模板掉落引用',
        })
      ).statusCode,
    ).toBe(200);

    const blocked = await adminInject('approver', 'POST', '/api/v1/admin/content/releases', {
      reason: '测试删除持有物品模板的发布',
    });
    expect(blocked.statusCode).toBe(422);
    const body = blocked.json<{ error: { message: string; details?: string[] } }>();
    expect(body.error.message).toContain('玩家仍持有');
    expect(JSON.stringify(body.error.details ?? [])).toContain('slime_gel');

    // Restore the drafts so a later run starts from a publishable state.
    await adminInject('designer', 'PUT', '/api/v1/admin/content/drafts/items', {
      section: 'items',
      payload: itemsPayload,
      reason: '测试恢复物品草稿',
    });
    await adminInject('designer', 'PUT', '/api/v1/admin/content/drafts/lootTables', {
      section: 'lootTables',
      payload: lootPayload,
      reason: '测试恢复掉落草稿',
    });
  });
});
