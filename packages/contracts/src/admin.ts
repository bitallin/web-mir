import { z } from 'zod';

import { contentSectionSchema } from './content';
import { characterClassSchema } from './character';
import { equipmentSlotSchema, itemKindSchema } from './economy';

/**
 * Admin console contracts. Roles and permissions are defined here so the
 * Control API and the browser bundle share one matrix; the server still checks
 * every request (the UI only hides what a role cannot use).
 */

export const ADMIN_ROLES = [
  'super_admin',
  'ops_admin',
  'game_master',
  'content_designer',
  'release_approver',
  'analyst',
  'readonly_auditor',
] as const;

export const adminRoleSchema = z.enum(ADMIN_ROLES);
export type AdminRole = z.infer<typeof adminRoleSchema>;

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: '超级管理员',
  ops_admin: '运营管理员',
  game_master: '游戏管理员',
  content_designer: '内容策划',
  release_approver: '发布审批',
  analyst: '数据分析',
  readonly_auditor: '只读审计',
};

export const ADMIN_PERMISSIONS = [
  'dashboard.read',
  'players.read',
  'players.action',
  'rooms.read',
  'audit.read',
  'commands.read',
  'content.read',
  'content.write',
  'content.validate',
  'content.publish',
  'content.activate',
] as const;

export const adminPermissionSchema = z.enum(ADMIN_PERMISSIONS);
export type AdminPermission = z.infer<typeof adminPermissionSchema>;

const ALL_PERMISSIONS: readonly AdminPermission[] = ADMIN_PERMISSIONS;

export const ADMIN_ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  super_admin: ALL_PERMISSIONS,
  ops_admin: [
    'dashboard.read',
    'players.read',
    'players.action',
    'rooms.read',
    'audit.read',
    'commands.read',
  ],
  game_master: ['dashboard.read', 'players.read', 'players.action', 'rooms.read'],
  content_designer: ['dashboard.read', 'content.read', 'content.write', 'content.validate'],
  release_approver: [
    'dashboard.read',
    'audit.read',
    'content.read',
    'content.validate',
    'content.publish',
    'content.activate',
  ],
  analyst: [
    'dashboard.read',
    'players.read',
    'rooms.read',
    'audit.read',
    'commands.read',
    'content.read',
  ],
  readonly_auditor: ['dashboard.read', 'rooms.read', 'audit.read', 'commands.read'],
};

export function permissionsForRole(role: AdminRole): readonly AdminPermission[] {
  return ADMIN_ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: AdminRole, permission: AdminPermission): boolean {
  return ADMIN_ROLE_PERMISSIONS[role].includes(permission);
}

export const adminUsernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_.-]+$/u, '管理员账号只能包含字母、数字、下划线、点和短横线');

export const adminLoginRequestSchema = z
  .object({
    username: adminUsernameSchema,
    password: z.string().min(8).max(128),
  })
  .strict();

export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;

export const adminViewSchema = z
  .object({
    id: z.uuid(),
    username: z.string().min(1),
    role: adminRoleSchema,
    permissions: z.array(adminPermissionSchema).min(1),
    createdAt: z.iso.datetime(),
    lastLoginAt: z.iso.datetime().nullable(),
  })
  .strict();

export type AdminView = z.infer<typeof adminViewSchema>;

export const adminAuthResponseSchema = z.object({ admin: adminViewSchema }).strict();
export type AdminAuthResponse = z.infer<typeof adminAuthResponseSchema>;

export const adminServiceStatusSchema = z.enum(['ok', 'degraded', 'offline']);
export type AdminServiceStatus = z.infer<typeof adminServiceStatusSchema>;

export const adminRoomSchema = z
  .object({
    roomId: z.string().min(1),
    mapId: z.string().min(1),
    instanceId: z.string().min(1),
    players: z.number().int().nonnegative(),
    tickP50Ms: z.number().nonnegative(),
    tickP95Ms: z.number().nonnegative(),
    tickP99Ms: z.number().nonnegative(),
    contentVersion: z.string().min(1),
    contentChecksum: z.string().min(16),
  })
  .strict();

export type AdminRoom = z.infer<typeof adminRoomSchema>;

export const adminGameServerStatusSchema = z
  .object({
    service: z.literal('game-server'),
    serverId: z.string().min(1),
    /** Realm bound to this process (ADR-023); rooms only accept its characters. */
    realm: z.string().min(1).max(32),
    uptimeSeconds: z.number().nonnegative(),
    rooms: z.array(adminRoomSchema).max(64),
    totals: z
      .object({
        rooms: z.number().int().nonnegative(),
        players: z.number().int().nonnegative(),
        activeCommands: z.number().int().nonnegative(),
      })
      .strict(),
    timestamp: z.iso.datetime(),
  })
  .strict();

export type AdminGameServerStatus = z.infer<typeof adminGameServerStatusSchema>;

export const adminRoomsResponseSchema = z
  .object({
    status: adminServiceStatusSchema,
    detail: z.string().max(200).optional(),
    gameServer: adminGameServerStatusSchema.nullable(),
    timestamp: z.iso.datetime(),
  })
  .strict();

export type AdminRoomsResponse = z.infer<typeof adminRoomsResponseSchema>;

export const adminDashboardSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    health: z
      .object({
        database: z.enum(['ok', 'error']),
        gameServer: adminServiceStatusSchema,
        detail: z.string().max(200).optional(),
      })
      .strict(),
    metrics: z
      .object({
        onlinePlayers: z.number().int().nonnegative(),
        rooms: z.number().int().nonnegative(),
        accounts: z.number().int().nonnegative(),
        characters: z.number().int().nonnegative(),
        pendingCommands: z.number().int().nonnegative(),
        failedCommands: z.number().int().nonnegative(),
        oldestPendingAgeMs: z.number().int().nonnegative().nullable(),
        activeContentVersion: z.string().min(1).nullable(),
      })
      .strict(),
    alerts: z
      .array(
        z
          .object({
            level: z.enum(['warning', 'error']),
            message: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(20),
    rooms: z.array(adminRoomSchema).max(64),
  })
  .strict();

export type AdminDashboard = z.infer<typeof adminDashboardSchema>;

export const adminPlayerSortSchema = z.enum(['name', 'level', 'updatedAt']);
export type AdminPlayerSort = z.infer<typeof adminPlayerSortSchema>;

export const adminPlayerListQuerySchema = z
  .object({
    query: z.string().trim().max(64).optional(),
    status: z.enum(['active', 'banned']).optional(),
    online: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(10).max(50).default(25),
    sortBy: adminPlayerSortSchema.default('updatedAt'),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export type AdminPlayerListQuery = z.infer<typeof adminPlayerListQuerySchema>;

export const adminPlayerSummarySchema = z
  .object({
    characterId: z.uuid(),
    name: z.string().min(1),
    classId: characterClassSchema,
    level: z.number().int().positive(),
    mapId: z.string().min(1),
    accountId: z.uuid(),
    username: z.string().min(1),
    accountStatus: z.enum(['active', 'banned']),
    mutedUntil: z.iso.datetime().nullable(),
    online: z.boolean(),
    gameServerId: z.string().nullable(),
    leaseExpiresAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type AdminPlayerSummary = z.infer<typeof adminPlayerSummarySchema>;

export const adminPlayersResponseSchema = z
  .object({
    items: z.array(adminPlayerSummarySchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict();

export type AdminPlayersResponse = z.infer<typeof adminPlayersResponseSchema>;

export const adminItemViewSchema = z
  .object({
    itemId: z.uuid(),
    templateId: z.string().min(1),
    name: z.string().min(1),
    kind: itemKindSchema,
    quantity: z.number().int().positive(),
    slotIndex: z.number().int().nonnegative().nullable(),
    equipSlot: equipmentSlotSchema.nullable(),
  })
  .strict();

export const adminAuditResultSchema = z.enum(['success', 'failed']);
export type AdminAuditResult = z.infer<typeof adminAuditResultSchema>;

export const adminAuditEntrySchema = z
  .object({
    id: z.uuid(),
    actorId: z.uuid().nullable(),
    actorUsername: z.string().min(1),
    actorRole: adminRoleSchema,
    action: z.string().min(1).max(64),
    targetType: z.string().min(1).max(32),
    targetId: z.string().max(64).nullable(),
    reason: z.string().max(200).nullable(),
    result: adminAuditResultSchema,
    errorCode: z.string().max(64).nullable(),
    requestId: z.string().min(1).max(128),
    createdAt: z.iso.datetime(),
  })
  .strict();

export type AdminAuditEntry = z.infer<typeof adminAuditEntrySchema>;

export const ADMIN_COMMAND_TYPES = ['kick', 'ban', 'mute'] as const;
export const adminCommandTypeSchema = z.enum(ADMIN_COMMAND_TYPES);
export type AdminCommandType = z.infer<typeof adminCommandTypeSchema>;

export const ADMIN_COMMAND_STATUSES = ['pending', 'dispatched', 'applied', 'failed'] as const;
export const adminCommandStatusSchema = z.enum(ADMIN_COMMAND_STATUSES);
export type AdminCommandStatus = z.infer<typeof adminCommandStatusSchema>;

export const ADMIN_COMMAND_STATUS_LABELS: Record<AdminCommandStatus, string> = {
  pending: '待投递',
  dispatched: '已投递',
  applied: '已执行',
  failed: '失败',
};

export const adminCommandViewSchema = z
  .object({
    id: z.uuid(),
    commandId: z.uuid(),
    type: adminCommandTypeSchema,
    status: adminCommandStatusSchema,
    targetType: z.string().min(1).max(32),
    targetId: z.uuid(),
    targetName: z.string().nullable(),
    reason: z.string().max(200),
    actorId: z.uuid().nullable(),
    actorUsername: z.string().min(1),
    attempts: z.number().int().nonnegative(),
    lastError: z.string().max(300).nullable(),
    createdAt: z.iso.datetime(),
    dispatchedAt: z.iso.datetime().nullable(),
    appliedAt: z.iso.datetime().nullable(),
  })
  .strict();

export type AdminCommandView = z.infer<typeof adminCommandViewSchema>;

export type AdminItemView = z.infer<typeof adminItemViewSchema>;

export const adminPlayerDetailSchema = z
  .object({
    character: adminPlayerSummarySchema.extend({
      exp: z.number().int().nonnegative(),
      hp: z.number().int().nonnegative(),
      maxHp: z.number().int().positive(),
      mp: z.number().int().nonnegative(),
      maxMp: z.number().int().nonnegative(),
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
      createdAt: z.iso.datetime(),
    }),
    account: z
      .object({
        id: z.uuid(),
        username: z.string().min(1),
        status: z.enum(['active', 'banned']),
        mutedUntil: z.iso.datetime().nullable(),
        createdAt: z.iso.datetime(),
      })
      .strict(),
    wallet: z.object({ balance: z.number().int().nonnegative() }).strict(),
    inventory: z.array(adminItemViewSchema).max(64),
    equipment: z
      .object({
        weapon: adminItemViewSchema.nullable(),
        armor: adminItemViewSchema.nullable(),
      })
      .strict(),
    recentAudit: z.array(adminAuditEntrySchema).max(10),
    recentCommands: z.array(adminCommandViewSchema).max(10),
  })
  .strict();

export type AdminPlayerDetail = z.infer<typeof adminPlayerDetailSchema>;

export const adminAuditQuerySchema = z
  .object({
    actor: z.string().trim().max(32).optional(),
    action: z.string().trim().max(64).optional(),
    targetId: z.string().trim().max(64).optional(),
    result: adminAuditResultSchema.optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(10).max(50).default(25),
  })
  .strict();

export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

export const adminAuditResponseSchema = z
  .object({
    items: z.array(adminAuditEntrySchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict();

export type AdminAuditResponse = z.infer<typeof adminAuditResponseSchema>;

export const adminCommandsQuerySchema = z
  .object({
    status: adminCommandStatusSchema.optional(),
    type: adminCommandTypeSchema.optional(),
    targetId: z.string().trim().max(64).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(10).max(50).default(25),
  })
  .strict();

export type AdminCommandsQuery = z.infer<typeof adminCommandsQuerySchema>;

export const adminCommandsResponseSchema = z
  .object({
    items: z.array(adminCommandViewSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict();

export type AdminCommandsResponse = z.infer<typeof adminCommandsResponseSchema>;

export const adminReasonSchema = z.string().trim().min(2).max(200);

export const adminKickRequestSchema = z.object({ reason: adminReasonSchema }).strict();
export const adminBanRequestSchema = z.object({ reason: adminReasonSchema }).strict();
export const adminMuteRequestSchema = z
  .object({
    reason: adminReasonSchema,
    durationSeconds: z.number().int().min(30).max(604_800),
  })
  .strict();

export type AdminMuteRequest = z.infer<typeof adminMuteRequestSchema>;

export const adminActionResultSchema = z
  .object({
    command: adminCommandViewSchema,
    auditId: z.uuid(),
  })
  .strict();

export type AdminActionResult = z.infer<typeof adminActionResultSchema>;

/**
 * Internal command delivered from the Control API outbox to the game server.
 * The game server deduplicates by `commandId` (ADR-022).
 */
export const adminCommandEnvelopeSchema = z.discriminatedUnion('type', [
  z
    .object({
      commandId: z.uuid(),
      type: z.literal('kick'),
      characterId: z.uuid(),
      reason: adminReasonSchema,
      issuedAt: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      commandId: z.uuid(),
      type: z.literal('ban'),
      accountId: z.uuid(),
      reason: adminReasonSchema,
      issuedAt: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      commandId: z.uuid(),
      type: z.literal('mute'),
      accountId: z.uuid(),
      mutedUntil: z.iso.datetime(),
      reason: adminReasonSchema,
      issuedAt: z.iso.datetime(),
    })
    .strict(),
]);

export type AdminCommandEnvelope = z.infer<typeof adminCommandEnvelopeSchema>;

export const adminCommandReceiptSchema = z
  .object({
    status: z.enum(['applied', 'duplicate']),
    applied: z.number().int().nonnegative(),
    timestamp: z.iso.datetime(),
  })
  .strict();

export type AdminCommandReceipt = z.infer<typeof adminCommandReceiptSchema>;

export const adminDraftSummarySchema = z
  .object({
    section: contentSectionSchema,
    updatedAt: z.iso.datetime(),
    updatedByUsername: z.string().min(1),
    dirty: z.boolean(),
  })
  .strict();

export type AdminDraftSummary = z.infer<typeof adminDraftSummarySchema>;

export const adminReleaseSummarySchema = z
  .object({
    id: z.uuid(),
    version: z.string().min(1).max(32),
    schemaVersion: z.number().int().positive(),
    checksum: z.string().min(16).max(64),
    createdBy: z.uuid().nullable(),
    createdByUsername: z.string().min(1),
    createdAt: z.iso.datetime(),
    note: z.string().max(300).nullable(),
    changeSummary: z
      .object({
        added: z.number().int().nonnegative(),
        removed: z.number().int().nonnegative(),
        changed: z.number().int().nonnegative(),
      })
      .strict(),
    active: z.boolean(),
  })
  .strict();

export type AdminReleaseSummary = z.infer<typeof adminReleaseSummarySchema>;

export const adminContentActivationSchema = z
  .object({
    id: z.uuid(),
    realmId: z.uuid(),
    releaseId: z.uuid(),
    releaseVersion: z.string().min(1),
    activatedBy: z.uuid().nullable(),
    activatedByUsername: z.string().min(1),
    reason: adminReasonSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();

export type AdminContentActivation = z.infer<typeof adminContentActivationSchema>;

export const adminContentStateSchema = z
  .object({
    activeRelease: adminReleaseSummarySchema.nullable(),
    previousRelease: adminReleaseSummarySchema.nullable(),
    lastActivation: adminContentActivationSchema.nullable(),
    drafts: z.array(adminDraftSummarySchema),
  })
  .strict();

export type AdminContentState = z.infer<typeof adminContentStateSchema>;

export const adminContentDraftDetailSchema = z
  .object({
    section: contentSectionSchema,
    payload: z.unknown(),
    baseRelease: adminReleaseSummarySchema.nullable(),
    updatedAt: z.iso.datetime().nullable(),
    updatedByUsername: z.string().nullable(),
  })
  .strict();

export type AdminContentDraftDetail = z.infer<typeof adminContentDraftDetailSchema>;

export const adminContentDraftUpdateSchema = z.discriminatedUnion('section', [
  z
    .object({
      section: z.literal('classes'),
      payload: z.record(z.string(), z.unknown()),
      reason: adminReasonSchema,
    })
    .strict(),
  z
    .object({
      section: z.literal('skills'),
      payload: z.record(z.string(), z.unknown()),
      reason: adminReasonSchema,
    })
    .strict(),
  z
    .object({
      section: z.literal('monsters'),
      payload: z.record(z.string(), z.unknown()),
      reason: adminReasonSchema,
    })
    .strict(),
  z
    .object({
      section: z.literal('items'),
      payload: z.record(z.string(), z.unknown()),
      reason: adminReasonSchema,
    })
    .strict(),
  z
    .object({
      section: z.literal('lootTables'),
      payload: z.record(z.string(), z.unknown()),
      reason: adminReasonSchema,
    })
    .strict(),
]);

export type AdminContentDraftUpdate = z.infer<typeof adminContentDraftUpdateSchema>;

export const contentIssueSchema = z
  .object({
    severity: z.enum(['error', 'warning']),
    path: z.string().min(1).max(300),
    message: z.string().min(1).max(300),
  })
  .strict();

export type ContentIssue = z.infer<typeof contentIssueSchema>;

export const contentChangeSchema = z
  .object({
    section: contentSectionSchema,
    id: z.string().min(1).max(64),
    kind: z.enum(['added', 'removed', 'changed']),
    fields: z.array(z.string().max(64)).max(50),
  })
  .strict();

export type ContentChange = z.infer<typeof contentChangeSchema>;

export const contentValidationReportSchema = z
  .object({
    valid: z.boolean(),
    checkedAt: z.iso.datetime(),
    baseChecksum: z.string().max(64).nullable(),
    bundleChecksum: z.string().min(16).max(64).nullable(),
    issues: z.array(contentIssueSchema).max(500),
    changes: z.array(contentChangeSchema).max(500),
    summary: z
      .object({
        added: z.number().int().nonnegative(),
        removed: z.number().int().nonnegative(),
        changed: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type ContentValidationReport = z.infer<typeof contentValidationReportSchema>;

export const adminContentValidateRequestSchema = z
  .object({ reason: adminReasonSchema.optional() })
  .strict();

export const adminContentPublishRequestSchema = z
  .object({
    reason: adminReasonSchema,
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export type AdminContentPublishRequest = z.infer<typeof adminContentPublishRequestSchema>;

export const adminContentPublishResponseSchema = z
  .object({
    release: adminReleaseSummarySchema,
    validation: contentValidationReportSchema,
  })
  .strict();

export type AdminContentPublishResponse = z.infer<typeof adminContentPublishResponseSchema>;

export const adminContentActivateRequestSchema = z
  .object({
    releaseId: z.uuid(),
    reason: adminReasonSchema,
  })
  .strict();

export type AdminContentActivateRequest = z.infer<typeof adminContentActivateRequestSchema>;

export const adminContentActivateResponseSchema = z
  .object({
    activation: adminContentActivationSchema,
    activeRelease: adminReleaseSummarySchema,
  })
  .strict();

export type AdminContentActivateResponse = z.infer<typeof adminContentActivateResponseSchema>;

export const adminContentReleasesResponseSchema = z
  .object({
    items: z.array(adminReleaseSummarySchema).max(100),
    activeReleaseId: z.uuid().nullable(),
  })
  .strict();

export type AdminContentReleasesResponse = z.infer<typeof adminContentReleasesResponseSchema>;
