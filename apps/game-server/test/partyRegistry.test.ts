import { describe, expect, it } from 'vitest';

import { PartyRegistry } from '../src/rooms/partyRegistry';

function registry(options: { maxMembers?: number; inviteTtlMs?: number } = {}) {
  let now = 1_000;
  const instance = new PartyRegistry({
    maxMembers: options.maxMembers ?? 4,
    now: () => now,
    inviteTtlMs: options.inviteTtlMs ?? 30_000,
  });
  const advance = (ms: number): void => {
    now += ms;
  };
  return { instance, advance };
}

function inviteIds(
  instance: PartyRegistry,
  from: string,
  to: string,
): { inviteId: string; expiresAt: number } {
  const result = instance.createInvite(from, to);
  if (result.kind !== 'invited') {
    throw new Error(`invite rejected: ${result.reason}`);
  }
  return { inviteId: result.invite.inviteId, expiresAt: result.invite.expiresAt };
}

describe('PartyRegistry', () => {
  it('creates the party when the first invite is accepted', () => {
    const { instance } = registry();
    const { inviteId } = inviteIds(instance, 'a', 'b');
    expect(instance.partyOf('a')).toBeUndefined();

    const result = instance.acceptInvite(inviteId, 'b');
    expect(result.kind).toBe('joined');
    if (result.kind !== 'joined') {
      return;
    }
    expect(result.party.leaderId).toBe('a');
    expect(result.party.memberIds).toEqual(['a', 'b']);
    expect(instance.partyOf('b')?.partyId).toBe(result.party.partyId);
    expect(instance.pendingInviteFor('b')).toBeUndefined();
  });

  it('only lets the addressed player accept or decline', () => {
    const { instance } = registry();
    const { inviteId } = inviteIds(instance, 'a', 'b');
    expect(instance.acceptInvite(inviteId, 'c')).toEqual({
      kind: 'rejected',
      reason: 'invite_expired',
    });
    expect(instance.declineInvite(inviteId, 'c')).toBe(false);
    expect(instance.declineInvite(inviteId, 'b')).toBe(true);
    expect(instance.pendingInviteFor('b')).toBeUndefined();
  });

  it('replaces an older invite for the same target', () => {
    const { instance } = registry();
    const first = inviteIds(instance, 'a', 'b');
    const second = inviteIds(instance, 'c', 'b');
    expect(instance.pendingInviteFor('b')?.inviteId).toBe(second.inviteId);
    expect(instance.acceptInvite(first.inviteId, 'b')).toEqual({
      kind: 'rejected',
      reason: 'invite_expired',
    });
  });

  it('refuses expired invites and drops them on sweep', () => {
    const { instance, advance } = registry({ inviteTtlMs: 1_000 });
    const { inviteId } = inviteIds(instance, 'a', 'b');
    advance(1_001);
    expect(instance.acceptInvite(inviteId, 'b')).toEqual({
      kind: 'rejected',
      reason: 'invite_expired',
    });
    const other = inviteIds(instance, 'a', 'c');
    advance(5_000);
    instance.expireInvites();
    expect(instance.pendingInviteFor('c')).toBeUndefined();
    expect(instance.acceptInvite(other.inviteId, 'c')).toEqual({
      kind: 'rejected',
      reason: 'invite_expired',
    });
  });

  it('refuses targets already in a party and full parties', () => {
    const { instance } = registry({ maxMembers: 2 });
    const first = inviteIds(instance, 'a', 'b');
    expect(instance.acceptInvite(first.inviteId, 'b').kind).toBe('joined');

    const busy = instance.createInvite('c', 'b');
    expect(busy).toEqual({ kind: 'rejected', reason: 'target_busy' });

    const full = instance.createInvite('a', 'c');
    expect(full).toEqual({ kind: 'rejected', reason: 'party_full' });
  });

  it('promotes the next member when the leader leaves', () => {
    const { instance } = registry();
    for (const target of ['b', 'c']) {
      const { inviteId } = inviteIds(instance, 'a', target);
      expect(instance.acceptInvite(inviteId, target).kind).toBe('joined');
    }
    const result = instance.leave('a');
    expect(result.formerPartyId).not.toBeNull();
    expect(result.party?.leaderId).toBe('b');
    expect(result.party?.memberIds).toEqual(['b', 'c']);
    expect(instance.partyOf('a')).toBeUndefined();
  });

  it('disbands when the last member leaves and drops that member’s invites', () => {
    const { instance } = registry();
    const { inviteId } = inviteIds(instance, 'a', 'b');
    instance.acceptInvite(inviteId, 'b');
    const pending = inviteIds(instance, 'a', 'c');

    expect(instance.leave('b').party?.memberIds).toEqual(['a']);
    const result = instance.leave('a');
    expect(result.party).toBeNull();
    expect(instance.pendingInviteFor('c')).toBeUndefined();
    expect(instance.acceptInvite(pending.inviteId, 'c')).toEqual({
      kind: 'rejected',
      reason: 'invite_expired',
    });
  });
});
