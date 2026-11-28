import { randomUUID } from 'node:crypto';

import {
  TRADE_INVITE_TTL_MS,
  TRADE_MAX_ITEM_STACKS,
  type CommandRejectionCode,
  type TradeCloseReason,
  type TradeOfferItemView,
  type TradeStatus,
} from '@web-legend/contracts';

/**
 * In-memory face-to-face trade table. Trades only exist while both players are
 * hosted by the same map room, so the table lives inside the room rather than
 * on the process (ADR-050). The final asset swap happens in PostgreSQL; this
 * class decides who may offer, lock and cancel, and never moves an item.
 */

export type TradeParticipant = {
  playerId: string;
  displayName: string;
};

export type TradeSideState = {
  playerId: string;
  displayName: string;
  items: TradeOfferItemView[];
  gold: number;
  locked: boolean;
};

export type TradeSessionState = {
  tradeId: string;
  status: TradeStatus;
  closeReason?: TradeCloseReason;
  sides: [TradeSideState, TradeSideState];
  createdAt: number;
};

export type TradeInviteState = {
  inviteId: string;
  fromPlayerId: string;
  fromDisplayName: string;
  toPlayerId: string;
  expiresAt: number;
};

export type TradeRejection = { kind: 'rejected'; code: CommandRejectionCode };
export type TradeInviteResult = { kind: 'invited'; invite: TradeInviteState } | TradeRejection;
export type TradeAcceptResult = { kind: 'started'; session: TradeSessionState } | TradeRejection;
export type TradeDeclineResult = { kind: 'declined'; invite: TradeInviteState } | TradeRejection;
export type TradeChangeResult = { kind: 'updated'; session: TradeSessionState } | TradeRejection;
export type TradeLockResult =
  | { kind: 'locked'; session: TradeSessionState }
  | { kind: 'ready'; session: TradeSessionState }
  | TradeRejection;
export type TradeCloseResult = { kind: 'closed'; session: TradeSessionState } | TradeRejection;

export type TradeRegistryOptions = {
  now?: () => number;
  inviteTtlMs?: number;
  newId?: () => string;
};

export class TradeRegistry {
  private readonly sessions = new Map<string, TradeSessionState>();
  private readonly sessionByPlayer = new Map<string, string>();
  private readonly invites = new Map<string, TradeInviteState>();
  private readonly now: () => number;
  private readonly inviteTtlMs: number;
  private readonly newId: () => string;

  constructor(options: TradeRegistryOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.inviteTtlMs = options.inviteTtlMs ?? TRADE_INVITE_TTL_MS;
    this.newId = options.newId ?? (() => randomUUID());
  }

  sessionOf(playerId: string): TradeSessionState | undefined {
    const tradeId = this.sessionByPlayer.get(playerId);
    return tradeId === undefined ? undefined : this.sessions.get(tradeId);
  }

  sessionById(tradeId: string): TradeSessionState | undefined {
    return this.sessions.get(tradeId);
  }

  invite(from: TradeParticipant, to: TradeParticipant): TradeInviteResult {
    if (from.playerId === to.playerId) {
      return { kind: 'rejected', code: 'TRADE_SELF' };
    }
    if (this.sessionByPlayer.has(from.playerId)) {
      return { kind: 'rejected', code: 'TRADE_ALREADY_TRADING' };
    }
    if (this.sessionByPlayer.has(to.playerId)) {
      return { kind: 'rejected', code: 'TRADE_TARGET_BUSY' };
    }
    this.purgeExpiredInvites();
    // Re-inviting replaces the previous unanswered invite between the pair so
    // both players always act on the newest invitation.
    for (const [inviteId, invite] of this.invites) {
      if (invite.fromPlayerId === from.playerId && invite.toPlayerId === to.playerId) {
        this.invites.delete(inviteId);
      }
    }
    const invite: TradeInviteState = {
      inviteId: this.newId(),
      fromPlayerId: from.playerId,
      fromDisplayName: from.displayName,
      toPlayerId: to.playerId,
      expiresAt: this.now() + this.inviteTtlMs,
    };
    this.invites.set(invite.inviteId, invite);
    return { kind: 'invited', invite };
  }

  accept(playerId: string, displayName: string, inviteId: string): TradeAcceptResult {
    const invite = this.invites.get(inviteId);
    if (invite === undefined || invite.toPlayerId !== playerId) {
      return { kind: 'rejected', code: 'TRADE_INVITE_EXPIRED' };
    }
    if (invite.expiresAt <= this.now()) {
      this.invites.delete(inviteId);
      return { kind: 'rejected', code: 'TRADE_INVITE_EXPIRED' };
    }
    if (this.sessionByPlayer.has(playerId)) {
      return { kind: 'rejected', code: 'TRADE_ALREADY_TRADING' };
    }
    if (this.sessionByPlayer.has(invite.fromPlayerId)) {
      return { kind: 'rejected', code: 'TRADE_TARGET_BUSY' };
    }

    this.invites.delete(inviteId);
    this.dropInvitesFor(playerId);
    this.dropInvitesFor(invite.fromPlayerId);

    const session: TradeSessionState = {
      tradeId: this.newId(),
      status: 'open',
      sides: [
        this.emptySide(invite.fromPlayerId, invite.fromDisplayName),
        this.emptySide(playerId, displayName),
      ],
      createdAt: this.now(),
    };
    this.sessions.set(session.tradeId, session);
    this.sessionByPlayer.set(invite.fromPlayerId, session.tradeId);
    this.sessionByPlayer.set(playerId, session.tradeId);
    return { kind: 'started', session };
  }

  decline(playerId: string, inviteId: string): TradeDeclineResult {
    const invite = this.invites.get(inviteId);
    if (invite === undefined || invite.toPlayerId !== playerId) {
      return { kind: 'rejected', code: 'TRADE_INVITE_EXPIRED' };
    }
    this.invites.delete(inviteId);
    return { kind: 'declined', invite };
  }

  offer(
    playerId: string,
    tradeId: string,
    items: TradeOfferItemView[],
    gold: number,
  ): TradeChangeResult {
    const opened = this.openSession(playerId, tradeId);
    if ('kind' in opened) {
      return opened;
    }
    if (items.length > TRADE_MAX_ITEM_STACKS) {
      return { kind: 'rejected', code: 'INVALID_QUANTITY' };
    }
    if (!Number.isSafeInteger(gold) || gold < 0) {
      return { kind: 'rejected', code: 'INVALID_QUANTITY' };
    }
    const side = this.sideOf(opened, playerId);
    if (side === undefined) {
      return { kind: 'rejected', code: 'TRADE_NOT_FOUND' };
    }
    if (side.locked) {
      return { kind: 'rejected', code: 'TRADE_LOCKED' };
    }
    side.items = items;
    side.gold = gold;
    // Any change voids both confirmations; the other player must see the new
    // offer before the swap can happen again.
    for (const other of opened.sides) {
      other.locked = false;
    }
    return { kind: 'updated', session: opened };
  }

  lock(playerId: string, tradeId: string): TradeLockResult {
    const opened = this.openSession(playerId, tradeId);
    if ('kind' in opened) {
      return opened;
    }
    const side = this.sideOf(opened, playerId);
    if (side === undefined) {
      return { kind: 'rejected', code: 'TRADE_NOT_FOUND' };
    }
    side.locked = true;
    if (opened.sides.every((entry) => entry.locked)) {
      opened.status = 'settling';
      return { kind: 'ready', session: opened };
    }
    return { kind: 'locked', session: opened };
  }

  /** Settlement failed after validation; both sides may edit and relock. */
  reopen(tradeId: string): TradeSessionState | undefined {
    const session = this.sessions.get(tradeId);
    if (session === undefined) {
      return undefined;
    }
    session.status = 'open';
    for (const side of session.sides) {
      side.locked = false;
    }
    return session;
  }

  cancel(playerId: string, tradeId: string): TradeCloseResult {
    const session = this.sessions.get(tradeId);
    if (session === undefined || this.sessionByPlayer.get(playerId) !== tradeId) {
      return { kind: 'rejected', code: 'TRADE_NOT_FOUND' };
    }
    return { kind: 'closed', session: this.closeSession(session, 'cancelled') };
  }

  /** Closes whichever trade a player is in; used by leave/death/transfer. */
  cancelForPlayer(playerId: string, reason: TradeCloseReason): TradeSessionState | undefined {
    const session = this.sessionOf(playerId);
    return session === undefined ? undefined : this.closeSession(session, reason);
  }

  /** Removes a finished session and returns its final snapshot for delivery. */
  complete(tradeId: string): TradeSessionState | undefined {
    const session = this.sessions.get(tradeId);
    return session === undefined ? undefined : this.closeSession(session, 'completed');
  }

  private closeSession(session: TradeSessionState, reason: TradeCloseReason): TradeSessionState {
    this.sessions.delete(session.tradeId);
    for (const side of session.sides) {
      if (this.sessionByPlayer.get(side.playerId) === session.tradeId) {
        this.sessionByPlayer.delete(side.playerId);
      }
    }
    session.status = reason === 'completed' ? 'completed' : 'cancelled';
    session.closeReason = reason;
    for (const side of session.sides) {
      side.locked = false;
    }
    return session;
  }

  private openSession(playerId: string, tradeId: string): TradeSessionState | TradeRejection {
    const session = this.sessions.get(tradeId);
    if (session === undefined || this.sessionByPlayer.get(playerId) !== tradeId) {
      return { kind: 'rejected', code: 'TRADE_NOT_FOUND' };
    }
    if (session.status !== 'open') {
      return { kind: 'rejected', code: 'TRADE_LOCKED' };
    }
    return session;
  }

  private sideOf(session: TradeSessionState, playerId: string): TradeSideState | undefined {
    return session.sides.find((side) => side.playerId === playerId);
  }

  private emptySide(playerId: string, displayName: string): TradeSideState {
    return { playerId, displayName, items: [], gold: 0, locked: false };
  }

  private dropInvitesFor(playerId: string): void {
    for (const [inviteId, invite] of this.invites) {
      if (invite.fromPlayerId === playerId || invite.toPlayerId === playerId) {
        this.invites.delete(inviteId);
      }
    }
  }

  private purgeExpiredInvites(): void {
    const now = this.now();
    for (const [inviteId, invite] of this.invites) {
      if (invite.expiresAt <= now) {
        this.invites.delete(inviteId);
      }
    }
  }
}
