import { describe, expect, it } from 'vitest';

import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLE_PERMISSIONS,
  ADMIN_ROLES,
  adminCommandEnvelopeSchema,
  adminLoginRequestSchema,
  permissionsForRole,
  roleHasPermission,
} from './admin';

describe('admin role matrix', () => {
  it('defines a permission set for every role', () => {
    for (const role of ADMIN_ROLES) {
      expect(permissionsForRole(role).length).toBeGreaterThan(0);
      for (const permission of ADMIN_ROLE_PERMISSIONS[role]) {
        expect(ADMIN_PERMISSIONS).toContain(permission);
      }
    }
  });

  it('grants the super admin every permission and no others more', () => {
    expect([...permissionsForRole('super_admin')].sort()).toEqual([...ADMIN_PERMISSIONS].sort());
  });

  it('separates content editing from release approval', () => {
    expect(roleHasPermission('content_designer', 'content.write')).toBe(true);
    expect(roleHasPermission('content_designer', 'content.publish')).toBe(false);
    expect(roleHasPermission('content_designer', 'content.activate')).toBe(false);
    expect(roleHasPermission('release_approver', 'content.publish')).toBe(true);
    expect(roleHasPermission('release_approver', 'content.activate')).toBe(true);
    expect(roleHasPermission('release_approver', 'content.write')).toBe(false);
  });

  it('never lets a read-only role perform player actions', () => {
    for (const role of ['analyst', 'readonly_auditor', 'content_designer'] as const) {
      expect(roleHasPermission(role, 'players.action')).toBe(false);
    }
  });
});

const COMMAND_ID = '00000000-0000-4000-8000-000000000001';
const TARGET_ID = '00000000-0000-4000-8000-000000000002';

describe('admin command envelope', () => {
  it('accepts kick, ban and mute with a stable command id', () => {
    const base = { commandId: COMMAND_ID, reason: '测试原因', issuedAt: new Date().toISOString() };
    expect(
      adminCommandEnvelopeSchema.safeParse({
        ...base,
        type: 'kick',
        characterId: TARGET_ID,
      }).success,
    ).toBe(true);
    expect(
      adminCommandEnvelopeSchema.safeParse({
        ...base,
        type: 'ban',
        accountId: TARGET_ID,
      }).success,
    ).toBe(true);
    expect(
      adminCommandEnvelopeSchema.safeParse({
        ...base,
        type: 'mute',
        accountId: TARGET_ID,
        mutedUntil: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });

  it('rejects client-supplied fields that are not in the command contract', () => {
    expect(
      adminCommandEnvelopeSchema.safeParse({
        commandId: COMMAND_ID,
        reason: '测试原因',
        issuedAt: new Date().toISOString(),
        type: 'kick',
        characterId: TARGET_ID,
        force: true,
      }).success,
    ).toBe(false);
  });
});

describe('admin login contract', () => {
  it('does not accept an empty or oversized password', () => {
    expect(
      adminLoginRequestSchema.safeParse({ username: 'admin', password: 'short' }).success,
    ).toBe(false);
    expect(
      adminLoginRequestSchema.safeParse({ username: 'admin', password: 'x'.repeat(129) }).success,
    ).toBe(false);
  });
});
