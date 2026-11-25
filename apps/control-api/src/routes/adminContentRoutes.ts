import {
  API_PREFIX,
  adminContentActivateRequestSchema,
  adminContentActivateResponseSchema,
  adminContentDraftDetailSchema,
  adminContentDraftUpdateSchema,
  adminContentPublishRequestSchema,
  adminContentPublishResponseSchema,
  adminContentReleasesResponseSchema,
  adminContentStateSchema,
  adminContentValidateRequestSchema,
  contentSectionSchema,
  contentValidationReportSchema,
  type ContentSection,
} from '@web-legend/contracts';
import type { FastifyRequest } from 'fastify';

import { AppError } from '../http/errors';
import {
  assertAdminPermission,
  parseBody,
  reasonFromBody,
  requireAdmin,
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

function requireSection(request: FastifyRequest): ContentSection {
  const parsed = contentSectionSchema.safeParse(param(request, 'section'));
  if (!parsed.success) {
    throw new AppError(422, 'VALIDATION_ERROR', '未知的内容类型');
  }
  return parsed.data;
}

export function registerAdminContentRoutes(app: AppServer, dependencies: RouteDependencies): void {
  app.get(`${API_PREFIX}/admin/content/state`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    assertAdminPermission(admin, 'content.read');
    return reply.send(adminContentStateSchema.parse(await dependencies.content.state()));
  });

  app.get(`${API_PREFIX}/admin/content/drafts/:section`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    assertAdminPermission(admin, 'content.read');
    const section = requireSection(request);
    return reply.send(
      adminContentDraftDetailSchema.parse(await dependencies.content.draftDetail(section)),
    );
  });

  app.put(`${API_PREFIX}/admin/content/drafts/:section`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    const section = requireSection(request);
    let body: { section: ContentSection; payload: Record<string, unknown>; reason: string };
    try {
      body = parseBody(adminContentDraftUpdateSchema, request.body);
    } catch (error) {
      await dependencies.content.auditRejected(
        admin,
        request.id,
        'content.draft.save',
        section,
        reasonFromBody(request.body),
        'VALIDATION_ERROR',
      );
      throw error;
    }
    if (body.section !== section) {
      await dependencies.content.auditRejected(
        admin,
        request.id,
        'content.draft.save',
        section,
        body.reason,
        'VALIDATION_ERROR',
      );
      throw new AppError(422, 'VALIDATION_ERROR', '路径内容类型与请求体不一致');
    }
    const saved = await dependencies.content.saveDraft(
      section,
      body.payload,
      body.reason,
      admin,
      request.id,
    );
    return reply.send(adminContentDraftDetailSchema.parse(saved));
  });

  app.post(`${API_PREFIX}/admin/content/validate`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    assertAdminPermission(admin, 'content.validate');
    parseBody(adminContentValidateRequestSchema, request.body ?? {});
    return reply.send(contentValidationReportSchema.parse(await dependencies.content.validate()));
  });

  app.post(`${API_PREFIX}/admin/content/releases`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    let body: { reason: string; note?: string | undefined };
    try {
      body = parseBody(adminContentPublishRequestSchema, request.body);
    } catch (error) {
      await dependencies.content.auditRejected(
        admin,
        request.id,
        'content.publish',
        'bundle',
        reasonFromBody(request.body),
        'VALIDATION_ERROR',
      );
      throw error;
    }
    const result = await dependencies.content.publish(body.reason, body.note, admin, request.id);
    return reply.status(201).send(adminContentPublishResponseSchema.parse(result));
  });

  app.get(`${API_PREFIX}/admin/content/releases`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    assertAdminPermission(admin, 'content.read');
    return reply.send(
      adminContentReleasesResponseSchema.parse(await dependencies.content.releases()),
    );
  });

  app.post(`${API_PREFIX}/admin/content/activate`, async (request, reply) => {
    const { admin } = await requireAdmin(dependencies, request);
    let body: { releaseId: string; reason: string };
    try {
      body = parseBody(adminContentActivateRequestSchema, request.body);
    } catch (error) {
      await dependencies.content.auditRejected(
        admin,
        request.id,
        'content.activate',
        'unknown',
        reasonFromBody(request.body),
        'VALIDATION_ERROR',
      );
      throw error;
    }
    const result = await dependencies.content.activate(
      body.releaseId,
      body.reason,
      admin,
      request.id,
    );
    return reply.send(adminContentActivateResponseSchema.parse(result));
  });
}
