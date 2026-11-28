import { randomUUID } from 'node:crypto';

import type { TradeOfferItemView } from '@web-legend/contracts';
import { describe, expect, it } from 'vitest';

import { TradeRegistry } from '../src/world/tradeRegistry';

const alice = { playerId: randomUUID(), displayName: 'Alice' };
const bob = { playerId: randomUUID(), displayName: 'Bob' };

function item(overrides: Partial<TradeOfferItemView> = {}): TradeOfferItemView {
  return {
    itemId: randomUUID(),
    templateId: 'small_hp_potion',
    name: '金创药',
    kind: 'consumable',
    quantity: 2,
    ...overrides,
  };
}

function startTrade(now = { value: 1_000 }): {
  registry: TradeRegistry;
  session: ReturnType<TradeRegistry['sessionById']>;
} {
  const registry = new TradeRegistry({ now: () => now.value });
  const invited = registry.invite(alice, bob);
  expect(invited.kind).toBe('invited');
  if (invited.kind !== 'invited') {
    throw new Error('invite failed');
  }
  const accepted = registry.accept(bob.playerId, bob.displayName, invited.invite.inviteId);
  expect(accepted.kind).toBe('started');
  if (accepted.kind !== 'started') {
    throw new Error('accept failed');
  }
  return { registry, session: accepted.session };
}

describe('TradeRegistry', () => {
  it('starts a trade only after the invite is accepted', () => {
    const registry = new TradeRegistry({ now: () => 1_000 });
    const invited = registry.invite(alice, bob);
    expect(invited.kind).toBe('invited');
    expect(registry.sessionOf(alice.playerId)).toBeUndefined();

    if (invited.kind !== 'invited') {
      throw new Error('invite failed');
    }
    expect(invited.invite.fromPlayerId).toBe(alice.playerId);
    expect(invited.invite.toPlayerId).toBe(bob.playerId);

    const accepted = registry.accept(bob.playerId, bob.displayName, invited.invite.inviteId);
    expect(accepted.kind).toBe('started');
    if (accepted.kind !== 'started') {
      throw new Error('accept failed');
    }
    expect(accepted.session.status).toBe('open');
    expect(accepted.session.sides.map((side) => side.displayName)).toEqual(['Alice', 'Bob']);
    expect(registry.sessionOf(alice.playerId)).toBe(accepted.session);
    expect(registry.sessionOf(bob.playerId)).toBe(accepted.session);
  });

  it('rejects trading with yourself and while either side is occupied', () => {
    const registry = new TradeRegistry({ now: () => 1_000 });
    expect(registry.invite(alice, alice)).toEqual({ kind: 'rejected', code: 'TRADE_SELF' });

    const invited = registry.invite(alice, bob);
    if (invited.kind !== 'invited') {
      throw new Error('invite failed');
    }
    registry.accept(bob.playerId, bob.displayName, invited.invite.inviteId);
    const third = { playerId: randomUUID(), displayName: 'Carol' };
    expect(registry.invite(alice, third)).toEqual({
      kind: 'rejected',
      code: 'TRADE_ALREADY_TRADING',
    });
    expect(registry.invite(third, bob)).toEqual({
      kind: 'rejected',
      code: 'TRADE_TARGET_BUSY',
    });
  });

  it('expires an unanswered invite', () => {
    const now = { value: 1_000 };
    const registry = new TradeRegistry({ now: () => now.value, inviteTtlMs: 500 });
    const invited = registry.invite(alice, bob);
    if (invited.kind !== 'invited') {
      throw new Error('invite failed');
    }
    now.value = 1_501;
    expect(registry.accept(bob.playerId, bob.displayName, invited.invite.inviteId)).toEqual({
      kind: 'rejected',
      code: 'TRADE_INVITE_EXPIRED',
    });
  });

  it('lets the invited player decline without starting a trade', () => {
    const registry = new TradeRegistry({ now: () => 1_000 });
    const invited = registry.invite(alice, bob);
    if (invited.kind !== 'invited') {
      throw new Error('invite failed');
    }
    const declined = registry.decline(bob.playerId, invited.invite.inviteId);
    expect(declined.kind).toBe('declined');
    expect(registry.sessionOf(alice.playerId)).toBeUndefined();
    expect(registry.decline(bob.playerId, invited.invite.inviteId)).toEqual({
      kind: 'rejected',
      code: 'TRADE_INVITE_EXPIRED',
    });
  });

  it('resets both locks whenever an offer changes', () => {
    const { registry, session } = startTrade();
    if (session === undefined) {
      throw new Error('no session');
    }
    const potion = item();
    const updated = registry.offer(alice.playerId, session.tradeId, [potion], 10);
    expect(updated.kind).toBe('updated');
    if (updated.kind !== 'updated') {
      throw new Error('offer failed');
    }
    expect(updated.session.sides[0]?.items).toEqual([potion]);
    expect(updated.session.sides[0]?.gold).toBe(10);

    const locked = registry.lock(alice.playerId, session.tradeId);
    expect(locked.kind).toBe('locked');
    expect(registry.offer(alice.playerId, session.tradeId, [], 0)).toEqual({
      kind: 'rejected',
      code: 'TRADE_LOCKED',
    });
  });

  it('unlocks the other side when the first side edits again after locking', () => {
    const { registry, session } = startTrade();
    if (session === undefined) {
      throw new Error('no session');
    }
    expect(registry.lock(alice.playerId, session.tradeId).kind).toBe('locked');
    expect(registry.lock(bob.playerId, session.tradeId).kind).toBe('ready');

    const reopened = registry.reopen(session.tradeId);
    expect(reopened?.status).toBe('open');
    expect(reopened?.sides.every((side) => !side.locked)).toBe(true);

    const updated = registry.offer(bob.playerId, session.tradeId, [item()], 0);
    expect(updated.kind).toBe('updated');
    if (updated.kind !== 'updated') {
      throw new Error('offer failed');
    }
    expect(updated.session.sides[0]?.locked).toBe(false);
    expect(updated.session.sides[1]?.locked).toBe(false);
  });

  it('blocks offers while the trade is settling', () => {
    const { registry, session } = startTrade();
    if (session === undefined) {
      throw new Error('no session');
    }
    registry.lock(alice.playerId, session.tradeId);
    const ready = registry.lock(bob.playerId, session.tradeId);
    expect(ready.kind).toBe('ready');
    expect(ready.kind === 'ready' ? ready.session.status : null).toBe('settling');

    expect(registry.offer(alice.playerId, session.tradeId, [], 0)).toEqual({
      kind: 'rejected',
      code: 'TRADE_LOCKED',
    });
    expect(registry.lock(alice.playerId, session.tradeId)).toEqual({
      kind: 'rejected',
      code: 'TRADE_LOCKED',
    });
  });

  it('closes a cancelled trade for both players', () => {
    const { registry, session } = startTrade();
    if (session === undefined) {
      throw new Error('no session');
    }
    const cancel = registry.cancel(alice.playerId, session.tradeId);
    expect(cancel.kind).toBe('closed');
    expect(registry.sessionOf(alice.playerId)).toBeUndefined();
    expect(registry.sessionOf(bob.playerId)).toBeUndefined();
    expect(registry.cancel(bob.playerId, session.tradeId)).toEqual({
      kind: 'rejected',
      code: 'TRADE_NOT_FOUND',
    });
  });

  it('cancels whichever trade a leaving player is in', () => {
    const { registry, session } = startTrade();
    if (session === undefined) {
      throw new Error('no session');
    }
    const closed = registry.cancelForPlayer(bob.playerId, 'player_left');
    expect(closed?.status).toBe('cancelled');
    expect(closed?.closeReason).toBe('player_left');
    expect(registry.sessionOf(alice.playerId)).toBeUndefined();
    expect(registry.cancelForPlayer(bob.playerId, 'player_left')).toBeUndefined();
  });

  it('marks a completed trade and releases both players', () => {
    const { registry, session } = startTrade();
    if (session === undefined) {
      throw new Error('no session');
    }
    const completed = registry.complete(session.tradeId);
    expect(completed?.status).toBe('completed');
    expect(completed?.closeReason).toBe('completed');
    expect(registry.sessionOf(alice.playerId)).toBeUndefined();
    expect(registry.sessionOf(bob.playerId)).toBeUndefined();
  });
});
