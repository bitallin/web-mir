import {
  API_PREFIX,
  adminActionResultSchema,
  adminAuditQuerySchema,
  adminAuditResponseSchema,
  adminBanRequestSchema,
  adminCommandsQuerySchema,
  adminCommandsResponseSchema,
  adminDashboardSchema,
  adminKickRequestSchema,
  adminMuteRequestSchema,
  adminPlayerDetailSchema,
  adminPlayerListQuerySchema,
  adminPlayersResponseSchema,
  adminRoomsResponseSchema,
} from '@web-legend/contracts';
import type { FastifyRequest } from 'fastify';

import {
  assertAdminPermission,
  parseBody,
  reasonFromBody,
  requireAdmin,
  requireUuid,
  type AppServer,
  type RouteDependencies,
} from './context';

function param(request: FastifyRequest, name: string): string | undefined {
  const params: unknown = request.params;
  if (typeof params !== 'object' || params === null || !(name in params)) {
    return undefined;
  }
  const value = (params as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

export function registerAdminRoutes(app: AppServer, dependencies: RouteDependencies): void {
  app.get(`${API_PREFIX}/admin/dashboard`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    assertAdminPermission(admin, 'dashboard.read');
    return reply.send(adminDashboardSchema.parse(await dependencies.admin.dashboard()));
  });

  app.get(`${API_PREFIX}/admin/players`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    assertAdminPermission(admin, 'players.read');
    const query = parseBody(adminPlayerListQuerySchema, request.query);
    return reply.send(adminPlayersResponseSchema.parse(await dependencies.admin.players(query)));
  });

  app.get(`${API_PREFIX}/admin/players/:characterId`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    assertAdminPermission(admin, 'players.read');
    const characterId = requireUuid(param(request, 'characterId'), '角色 ID');
    return reply.send(
      adminPlayerDetailSchema.parse(await dependencies.admin.playerDetail(characterId)),
    );
  });

  app.get(`${API_PREFIX}/admin/rooms`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    assertAdminPermission(admin, 'rooms.read');
    return reply.send(adminRoomsResponseSchema.parse(await dependencies.admin.rooms()));
  });

  app.get(`${API_PREFIX}/admin/audit-logs`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    assertAdminPermission(admin, 'audit.read');
    const query = parseBody(adminAuditQuerySchema, request.query);
    return reply.send(adminAuditResponseSchema.parse(await dependencies.admin.audit(query)));
  });

  app.get(`${API_PREFIX}/admin/commands`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    assertAdminPermission(admin, 'commands.read');
    const query = parseBody(adminCommandsQuerySchema, request.query);
    return reply.send(adminCommandsResponseSchema.parse(await dependencies.admin.commands(query)));
  });

  app.post(`${API_PREFIX}/admin/players/:characterId/actions/kick`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    const characterId = requireUuid(param(request, 'characterId'), '角色 ID');
    let body: { reason: string };
    try {
      body = parseBody(adminKickRequestSchema, request.body);
    } catch (error) {
      await dependencies.admin.auditRejected(
        admin,
        request.id,
        'player.kick',
        characterId,
        reasonFromBody(request.body),
        'VALIDATION_ERROR',
      );
      throw error;
    }
    const result = await dependencies.admin.kick(characterId, body.reason, admin, request.id);
    return reply.send(adminActionResultSchema.parse(result));
  });

  app.post(`${API_PREFIX}/admin/players/:characterId/actions/ban`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    const characterId = requireUuid(param(request, 'characterId'), '角色 ID');
    let body: { reason: string };
    try {
      body = parseBody(adminBanRequestSchema, request.body);
    } catch (error) {
      await dependencies.admin.auditRejected(
        admin,
        request.id,
        'player.ban',
        characterId,
        reasonFromBody(request.body),
        'VALIDATION_ERROR',
      );
      throw error;
    }
    const result = await dependencies.admin.ban(characterId, body.reason, admin, request.id);
    return reply.send(adminActionResultSchema.parse(result));
  });

  app.post(`${API_PREFIX}/admin/players/:characterId/actions/mute`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    const characterId = requireUuid(param(request, 'characterId'), '角色 ID');
    let body: { reason: string; durationSeconds: number };
    try {
      body = parseBody(adminMuteRequestSchema, request.body);
    } catch (error) {
      await dependencies.admin.auditRejected(
        admin,
        request.id,
        'player.mute',
        characterId,
        reasonFromBody(request.body),
        'VALIDATION_ERROR',
      );
      throw error;
    }
    const result = await dependencies.admin.mute(
      characterId,
      body.reason,
      body.durationSeconds,
      admin,
      request.id,
    );
    return reply.send(adminActionResultSchema.parse(result));
  });
}
