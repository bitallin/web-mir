import {
  BASE_CONTENT_BUNDLE,
  buildReleaseVersion,
  canonicalJson,
  composeContentBundle,
  contentChecksum,
  diffContentBundles,
  summarizeChanges,
  validateContentBundle,
} from '@web-legend/content-schema';
import {
  CONTENT_SECTIONS,
  contentSectionDataSchemas,
  roleHasPermission,
  type AdminContentActivation,
  type AdminContentDraftDetail,
  type AdminContentPublishResponse,
  type AdminContentState,
  type AdminDraftSummary,
  type AdminReleaseSummary,
  type ContentBundle,
  type ContentChange,
  type ContentSection,
  type ContentValidationReport,
} from '@web-legend/contracts';
import {
  activateContentRelease,
  countReleasesCreatedBetween,
  findContentDraft,
  findContentReleaseById,
  findRealmActiveContent,
  insertAdminAudit,
  insertContentRelease,
  isUniqueViolation,
  listActiveRealms,
  listContentActivations,
  listContentDrafts,
  listContentReleases,
  upsertContentDraft,
  type AdminUser,
  type ContentDraft,
  type ContentRelease,
  type Database,
  type Realm,
} from '@web-legend/persistence';
import type { Logger } from 'pino';

import { AppError } from '../http/errors';
import { toAdminActivation, toAdminReleaseSummary } from './adminViews';

export type ContentDraftView = {
  section: ContentSection;
  payload: unknown;
  baseRelease: AdminReleaseSummary | null;
  updatedAt: string | null;
  updatedByUsername: string | null;
};

type ValidatedCandidate = {
  report: ContentValidationReport;
  bundle: ContentBundle | null;
  changes: ContentChange[];
};

function sectionDataOf(bundle: ContentBundle, section: ContentSection): unknown {
  return bundle[section];
}

function draftPayload(
  draft: ContentDraft | undefined,
  bundle: ContentBundle,
  section: ContentSection,
): unknown {
  return draft === undefined ? sectionDataOf(bundle, section) : draft.payload;
}

/**
 * Content draft, validation, release and activation use cases (ADR-022).
 * Releases are immutable rows; activation is append-only history so rollback is
 * another activation, never an edit.
 */
export class ContentService {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async activeRealm(): Promise<Realm> {
    const [realm] = await listActiveRealms(this.db);
    if (realm === undefined) {
      throw new AppError(404, 'REALM_NOT_FOUND', '当前没有可用区服');
    }
    return realm;
  }

  async bundleForRealm(realmId: string): Promise<ContentBundle> {
    const active = await findRealmActiveContent(this.db, realmId);
    if (active === undefined) {
      return BASE_CONTENT_BUNDLE;
    }
    const validated = validateContentBundle(active.release.payload);
    if (!validated.valid || validated.bundle === null) {
      this.logger.error(
        { releaseId: active.release.id, version: active.release.version },
        'active content release is invalid; falling back to the shipped baseline',
      );
      return BASE_CONTENT_BUNDLE;
    }
    return validated.bundle;
  }

  async activeBundle(): Promise<{ bundle: ContentBundle; release: ContentRelease | null }> {
    const realm = await this.activeRealm();
    const active = await findRealmActiveContent(this.db, realm.id);
    if (active === undefined) {
      return { bundle: BASE_CONTENT_BUNDLE, release: null };
    }
    const validated = validateContentBundle(active.release.payload);
    return {
      bundle: validated.bundle ?? BASE_CONTENT_BUNDLE,
      release: active.release,
    };
  }

  async state(): Promise<AdminContentState> {
    const realm = await this.activeRealm();
    const active = await findRealmActiveContent(this.db, realm.id);
    const activeId = active?.release.id ?? null;
    const drafts = await listContentDrafts(this.db);
    const activations = await listContentActivations(this.db, realm.id, 20);
    const previousActivation = activations.find(
      (activation) => activation.contentReleaseId !== activeId,
    );
    const previousRelease =
      previousActivation === undefined
        ? null
        : ((await findContentReleaseById(this.db, previousActivation.contentReleaseId)) ?? null);
    let lastActivation: AdminContentActivation | null = null;
    const latest = activations[0];
    if (latest !== undefined) {
      let version: string;
      if (active !== undefined && latest.contentReleaseId === active.release.id) {
        version = active.release.version;
      } else {
        const release = await findContentReleaseById(this.db, latest.contentReleaseId);
        version = release?.version ?? 'unknown';
      }
      lastActivation = toAdminActivation(latest, version);
    }

    const bundle = active === undefined ? BASE_CONTENT_BUNDLE : await this.bundleForRealm(realm.id);
    const draftSummaries: AdminDraftSummary[] = drafts.map((draft) => ({
      section: draft.section,
      updatedAt: draft.updatedAt.toISOString(),
      updatedByUsername: draft.updatedByUsername,
      dirty: canonicalJson(draft.payload) !== canonicalJson(sectionDataOf(bundle, draft.section)),
    }));

    return {
      activeRelease: active === undefined ? null : toAdminReleaseSummary(active.release, activeId),
      previousRelease:
        previousRelease === null ? null : toAdminReleaseSummary(previousRelease, activeId),
      lastActivation,
      drafts: draftSummaries,
    };
  }

  async draftDetail(section: ContentSection): Promise<AdminContentDraftDetail> {
    const draft = await findContentDraft(this.db, section);
    const { bundle, release } = await this.activeBundle();
    return {
      section,
      payload: draftPayload(draft, bundle, section),
      baseRelease: release === null ? null : toAdminReleaseSummary(release, release.id),
      updatedAt: draft?.updatedAt.toISOString() ?? null,
      updatedByUsername: draft?.updatedByUsername ?? null,
    };
  }

  async saveDraft(
    section: ContentSection,
    payload: unknown,
    reason: string,
    admin: AdminUser,
    requestId: string,
  ): Promise<AdminContentDraftDetail> {
    await this.assertPermission(
      admin,
      'content.write',
      requestId,
      'content.draft.save',
      section,
      reason,
    );
    const parsed = contentSectionDataSchemas[section].safeParse(payload);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 20).map((issue) => ({
        severity: 'error' as const,
        path: ['payload', ...issue.path.map((segment) => String(segment))].join('.'),
        message: issue.message.slice(0, 300),
      }));
      await this.recordFailure(admin, requestId, 'content.draft.save', section, reason, issues);
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        `${section} 草稿格式不合法`,
        issues.map((issue) => `${issue.path}: ${issue.message}`),
      );
    }

    const now = this.now();
    const saved = await this.db.transaction(async (tx) => {
      const draft = await upsertContentDraft(tx, {
        section,
        payload: parsed.data,
        adminUserId: admin.id,
        adminUsername: admin.username,
        now,
      });
      await insertAdminAudit(tx, {
        requestId,
        actorAdminId: admin.id,
        actorUsername: admin.username,
        actorRole: admin.role,
        action: 'content.draft.save',
        targetType: 'content_draft',
        targetId: section,
        reason,
        before: null,
        after: { section },
        result: 'success',
        createdAt: now,
      });
      return draft;
    });

    const { release } = await this.activeBundle();
    return {
      section,
      payload: saved.payload,
      baseRelease: release === null ? null : toAdminReleaseSummary(release, release.id),
      updatedAt: saved.updatedAt.toISOString(),
      updatedByUsername: saved.updatedByUsername,
    };
  }

  async validate(): Promise<ContentValidationReport> {
    return (await this.buildCandidate()).report;
  }

  async publish(
    reason: string,
    note: string | undefined,
    admin: AdminUser,
    requestId: string,
  ): Promise<AdminContentPublishResponse> {
    await this.assertPermission(
      admin,
      'content.publish',
      requestId,
      'content.publish',
      'bundle',
      reason,
    );
    const candidate = await this.buildCandidate();
    if (!candidate.report.valid || candidate.bundle === null) {
      await this.recordFailure(
        admin,
        requestId,
        'content.publish',
        'bundle',
        reason,
        candidate.report.issues.filter((issue) => issue.severity === 'error').slice(0, 20),
      );
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        '内容校验未通过，无法发布',
        candidate.report.issues
          .filter((issue) => issue.severity === 'error')
          .slice(0, 20)
          .map((issue) => `${issue.path}: ${issue.message}`),
      );
    }
    if (candidate.changes.length === 0) {
      await this.recordFailure(admin, requestId, 'content.publish', 'bundle', reason, []);
      throw new AppError(409, 'VALIDATION_ERROR', '内容与当前激活版本一致，无需发布');
    }

    const bundle = candidate.bundle;
    const realm = await this.activeRealm();
    const active = await findRealmActiveContent(this.db, realm.id);
    const now = this.now();
    const checksum = contentChecksum(bundle);
    const summary = summarizeChanges(candidate.changes);

    let release: ContentRelease | null = null;
    for (let attempt = 1; attempt <= 3 && release === null; attempt += 1) {
      const dayStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1_000);
      const sequence = (await countReleasesCreatedBetween(this.db, dayStart, dayEnd)) + attempt;
      const version = buildReleaseVersion(now, sequence);
      try {
        release = await this.db.transaction(async (tx) => {
          const inserted = await insertContentRelease(tx, {
            version,
            schemaVersion: bundle.schemaVersion,
            checksum,
            payload: bundle,
            changeSummary: summary,
            createdBy: admin.id,
            createdByUsername: admin.username,
            note: note ?? null,
            createdAt: now,
          });
          await insertAdminAudit(tx, {
            requestId,
            actorAdminId: admin.id,
            actorUsername: admin.username,
            actorRole: admin.role,
            action: 'content.publish',
            targetType: 'content_release',
            targetId: inserted.id,
            reason,
            before: { activeReleaseId: active?.release.id ?? null },
            after: { releaseId: inserted.id, version, checksum, summary },
            result: 'success',
            createdAt: now,
          });
          return inserted;
        });
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 3) {
          throw error;
        }
      }
    }
    if (release === null) {
      throw new AppError(409, 'VALIDATION_ERROR', '发布版本号冲突，请重试');
    }

    return {
      release: toAdminReleaseSummary(release, active?.release.id ?? null),
      validation: candidate.report,
    };
  }

  async activate(
    releaseId: string,
    reason: string,
    admin: AdminUser,
    requestId: string,
  ): Promise<{ activation: AdminContentActivation; activeRelease: AdminReleaseSummary }> {
    await this.assertPermission(
      admin,
      'content.activate',
      requestId,
      'content.activate',
      releaseId,
      reason,
    );
    const realm = await this.activeRealm();
    const release = await findContentReleaseById(this.db, releaseId);
    if (release === undefined) {
      await this.recordFailure(admin, requestId, 'content.activate', releaseId, reason, []);
      throw new AppError(404, 'NOT_FOUND', '内容版本不存在');
    }
    const validated = validateContentBundle(release.payload);
    if (!validated.valid) {
      await this.recordFailure(admin, requestId, 'content.activate', releaseId, reason, [
        { path: 'release', message: 'release payload is invalid' },
      ]);
      throw new AppError(422, 'VALIDATION_ERROR', '该内容版本校验未通过，不能激活');
    }

    const current = await findRealmActiveContent(this.db, realm.id);
    const now = this.now();
    const activation = await this.db.transaction(async (tx) => {
      const row = await activateContentRelease(tx, {
        realmId: realm.id,
        releaseId: release.id,
        adminUserId: admin.id,
        adminUsername: admin.username,
        reason,
        now,
      });
      await insertAdminAudit(tx, {
        requestId,
        actorAdminId: admin.id,
        actorUsername: admin.username,
        actorRole: admin.role,
        action: 'content.activate',
        targetType: 'content_release',
        targetId: release.id,
        reason,
        before: { activeReleaseId: current?.release.id ?? null },
        after: { activeReleaseId: release.id, version: release.version },
        result: 'success',
        createdAt: now,
      });
      return row;
    });

    return {
      activation: toAdminActivation(activation, release.version),
      activeRelease: toAdminReleaseSummary(release, release.id),
    };
  }

  async releases(): Promise<{ items: AdminReleaseSummary[]; activeReleaseId: string | null }> {
    const realm = await this.activeRealm();
    const active = await findRealmActiveContent(this.db, realm.id);
    const rows = await listContentReleases(this.db, 100);
    const activeId = active?.release.id ?? null;
    return {
      items: rows.map((release) => toAdminReleaseSummary(release, activeId)),
      activeReleaseId: activeId,
    };
  }

  private async buildCandidate(): Promise<ValidatedCandidate> {
    const { bundle: baseBundle, release } = await this.activeBundle();
    const drafts = await listContentDrafts(this.db);
    const draftSections: Partial<Record<ContentSection, unknown>> = {};
    for (const draft of drafts) {
      draftSections[draft.section] = draft.payload;
    }
    const composed = composeContentBundle(baseBundle, draftSections);
    const validation = validateContentBundle(composed);
    const changes =
      validation.bundle === null ? [] : diffContentBundles(baseBundle, validation.bundle);
    const summary = summarizeChanges(changes);
    const report: ContentValidationReport = {
      valid: validation.valid,
      checkedAt: this.now().toISOString(),
      baseChecksum: release?.checksum ?? null,
      bundleChecksum: validation.bundle === null ? null : contentChecksum(validation.bundle),
      issues: validation.issues,
      changes,
      summary,
    };
    return { report, bundle: validation.bundle, changes };
  }

  private async assertPermission(
    admin: AdminUser,
    permission: Parameters<typeof roleHasPermission>[1],
    requestId: string,
    action: string,
    targetId: string,
    reason: string,
  ): Promise<void> {
    if (roleHasPermission(admin.role, permission)) {
      return;
    }
    await this.recordFailure(admin, requestId, action, targetId, reason, [
      { path: 'permission', message: permission },
    ]);
    throw new AppError(403, 'FORBIDDEN', '没有执行该内容操作的权限');
  }

  /** Records a rejected content write (body validation, permission, target). */
  async auditRejected(
    admin: AdminUser,
    requestId: string,
    action: string,
    targetId: string,
    reason: string | null,
    errorCode: string,
  ): Promise<void> {
    await this.recordFailure(admin, requestId, action, targetId, reason ?? '', [], errorCode);
  }

  private async recordFailure(
    admin: AdminUser,
    requestId: string,
    action: string,
    targetId: string,
    reason: string,
    issues: readonly { path: string; message: string }[],
    errorCode = 'VALIDATION_ERROR',
  ): Promise<void> {
    try {
      await insertAdminAudit(this.db, {
        requestId,
        actorAdminId: admin.id,
        actorUsername: admin.username,
        actorRole: admin.role,
        action,
        targetType: 'content',
        targetId,
        reason,
        before: null,
        after: issues.length === 0 ? null : { issues: issues.map((issue) => issue.path) },
        result: 'failed',
        errorCode,
        createdAt: this.now(),
      });
    } catch (error) {
      this.logger.error({ err: error, action }, 'failed to record content audit failure');
    }
  }
}

export function contentSectionList(): readonly ContentSection[] {
  return CONTENT_SECTIONS;
}
