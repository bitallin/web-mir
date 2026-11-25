import {
  adminCommandViewSchema,
  adminAuditEntrySchema,
  adminViewSchema,
  permissionsForRole,
  type AdminAuditEntry,
  type AdminCommandView,
  type AdminContentActivation,
  type AdminPlayerSummary,
  type AdminReleaseSummary,
  type AdminView,
} from '@web-legend/contracts';
import type {
  AdminAuditLog,
  AdminPlayerRow,
  AdminUser,
  ContentActivation,
  ContentRelease,
  ItemInstance,
  OutboxEvent,
} from '@web-legend/persistence';

import type { AdminItemView } from '@web-legend/contracts';

export function toAdminView(admin: AdminUser): AdminView {
  return adminViewSchema.parse({
    id: admin.id,
    username: admin.username,
    role: admin.role,
    permissions: permissionsForRole(admin.role),
    createdAt: admin.createdAt.toISOString(),
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
  });
}

export function toAdminAuditEntry(row: AdminAuditLog): AdminAuditEntry {
  return adminAuditEntrySchema.parse({
    id: row.id,
    actorId: row.actorAdminId,
    actorUsername: row.actorUsername,
    actorRole: row.actorRole,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    reason: row.reason,
    result: row.result,
    errorCode: row.errorCode,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  });
}

export function toAdminCommandView(row: OutboxEvent): AdminCommandView {
  return adminCommandViewSchema.parse({
    id: row.id,
    commandId: row.commandId,
    type: row.type,
    status: row.status,
    targetType: row.targetType,
    targetId: row.targetId,
    targetName: row.targetName,
    reason: row.reason,
    actorId: row.actorAdminId,
    actorUsername: row.actorUsername,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    appliedAt: row.appliedAt?.toISOString() ?? null,
  });
}

export function toAdminPlayerSummary(row: AdminPlayerRow, now: Date): AdminPlayerSummary {
  const online = row.leaseExpiresAt !== null && row.leaseExpiresAt.getTime() > now.getTime();
  return {
    characterId: row.characterId,
    name: row.name,
    classId: row.classId,
    level: row.level,
    mapId: row.mapId,
    accountId: row.accountId,
    username: row.username,
    accountStatus: row.accountStatus,
    mutedUntil: row.mutedUntil?.toISOString() ?? null,
    online,
    gameServerId: online ? row.gameServerId : null,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAdminItemView(
  item: ItemInstance,
  name: string,
  kind: AdminItemView['kind'],
): AdminItemView {
  return {
    itemId: item.id,
    templateId: item.templateId,
    name,
    kind,
    quantity: item.quantity,
    slotIndex: item.slotIndex,
    equipSlot: item.equipSlot,
  };
}

function summaryOf(value: unknown): { added: number; removed: number; changed: number } {
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const read = (key: string): number => {
      const value = record[key];
      return typeof value === 'number' && Number.isInteger(value) ? value : 0;
    };
    return { added: read('added'), removed: read('removed'), changed: read('changed') };
  }
  return { added: 0, removed: 0, changed: 0 };
}

export function toAdminReleaseSummary(
  release: ContentRelease,
  activeReleaseId: string | null,
): AdminReleaseSummary {
  return {
    id: release.id,
    version: release.version,
    schemaVersion: release.schemaVersion,
    checksum: release.checksum,
    createdBy: release.createdBy,
    createdByUsername: release.createdByUsername,
    createdAt: release.createdAt.toISOString(),
    note: release.note,
    changeSummary: summaryOf(release.changeSummary),
    active: release.id === activeReleaseId,
  };
}

export function toAdminActivation(
  row: ContentActivation,
  releaseVersion: string,
): AdminContentActivation {
  return {
    id: row.id,
    realmId: row.realmId,
    releaseId: row.contentReleaseId,
    releaseVersion,
    activatedBy: row.activatedBy,
    activatedByUsername: row.activatedByUsername,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}
