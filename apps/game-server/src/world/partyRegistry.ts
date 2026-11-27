import { PARTY_INVITE_TTL_MS } from '@web-legend/contracts';
import { randomUUID } from 'node:crypto';

/**
 * Party membership for one room (ADR-035). Parties are transient social state
 * like room presence, so they live in memory: they do not survive a process
 * restart and a member who transfers to another map leaves the party. Keeping
 * them out of PostgreSQL also keeps the fixed tick free of asset transactions.
 */

export type PartyState = {
  partyId: string;
  leaderId: string;
  /** Join order; the first remaining member inherits leadership. */
  memberIds: string[];
};

export type PartyInviteRecord = {
  inviteId: string;
  fromPlayerId: string;
  toPlayerId: string;
  expiresAt: number;
};

export type PartyInviteResult =
  | { kind: 'invited'; invite: PartyInviteRecord }
  | { kind: 'rejected'; reason: 'party_full' | 'target_busy' };

export type PartyAcceptResult =
  | { kind: 'joined'; party: PartyState }
  | { kind: 'rejected'; reason: 'invite_expired' | 'already_in_party' | 'party_full' };

export type PartyLeaveResult = {
  /** The party as it stands after the departure, or null when it disbanded. */
  party: PartyState | null;
  /** The party the leaver belonged to, so the room can notify its members. */
  formerPartyId: string | null;
};

export type PartyManagementRejection =
  'not_in_party' | 'not_leader' | 'target_not_member' | 'target_self';

export type PartyLeaderChangeResult =
  | { kind: 'transferred'; party: PartyState }
  | { kind: 'rejected'; reason: PartyManagementRejection };

export type PartyKickResult =
  | { kind: 'kicked'; party: PartyState; kickedId: string }
  | { kind: 'rejected'; reason: PartyManagementRejection };

export type PartyRegistryOptions = {
  maxMembers: number;
  now?: () => number;
  inviteTtlMs?: number;
};

export class PartyRegistry {
  private readonly parties = new Map<string, PartyState>();
  private readonly partyIdByMember = new Map<string, string>();
  private readonly invites = new Map<string, PartyInviteRecord>();
  /** One pending invite per target; a newer invite replaces the older one. */
  private readonly inviteIdByTarget = new Map<string, string>();

  private readonly now: () => number;
  private readonly inviteTtlMs: number;

  constructor(private readonly options: PartyRegistryOptions) {
    this.now = options.now ?? (() => Date.now());
    this.inviteTtlMs = options.inviteTtlMs ?? PARTY_INVITE_TTL_MS;
  }

  get maxMembers(): number {
    return this.options.maxMembers;
  }

  /** Applied once the server has loaded the active content release. */
  setMaxMembers(maxMembers: number): void {
    this.options.maxMembers = maxMembers;
  }

  partyOf(playerId: string): PartyState | undefined {
    const partyId = this.partyIdByMember.get(playerId);
    return partyId === undefined ? undefined : this.parties.get(partyId);
  }

  isMember(playerId: string): boolean {
    return this.partyIdByMember.has(playerId);
  }

  sizeOf(partyId: string): number {
    return this.parties.get(partyId)?.memberIds.length ?? 0;
  }

  /**
   * Records an invitation. The party itself is created when the first invite is
   * accepted, so an ignored invite never leaves the inviter in a party of one.
   */
  createInvite(fromPlayerId: string, toPlayerId: string): PartyInviteResult {
    const inviterParty = this.partyOf(fromPlayerId);
    if (inviterParty !== undefined && inviterParty.memberIds.length >= this.maxMembers) {
      return { kind: 'rejected', reason: 'party_full' };
    }
    if (this.isMember(toPlayerId)) {
      return { kind: 'rejected', reason: 'target_busy' };
    }

    const existing = this.inviteIdByTarget.get(toPlayerId);
    if (existing !== undefined) {
      this.invites.delete(existing);
    }
    const invite: PartyInviteRecord = {
      inviteId: randomUUID(),
      fromPlayerId,
      toPlayerId,
      expiresAt: this.now() + this.inviteTtlMs,
    };
    this.invites.set(invite.inviteId, invite);
    this.inviteIdByTarget.set(toPlayerId, invite.inviteId);
    return { kind: 'invited', invite };
  }

  acceptInvite(inviteId: string, acceptingPlayerId: string): PartyAcceptResult {
    const invite = this.invites.get(inviteId);
    if (invite === undefined || invite.toPlayerId !== acceptingPlayerId) {
      // Never drop the invite here: a forged accept from another player must
      // not be able to cancel the intended recipient's invitation.
      return { kind: 'rejected', reason: 'invite_expired' };
    }
    if (invite.expiresAt <= this.now()) {
      this.dropInvite(invite);
      return { kind: 'rejected', reason: 'invite_expired' };
    }
    if (this.isMember(acceptingPlayerId)) {
      return { kind: 'rejected', reason: 'already_in_party' };
    }

    const party = this.partyOf(invite.fromPlayerId) ?? this.createParty(invite.fromPlayerId);
    if (party.memberIds.length >= this.maxMembers) {
      return { kind: 'rejected', reason: 'party_full' };
    }
    party.memberIds.push(acceptingPlayerId);
    this.partyIdByMember.set(acceptingPlayerId, party.partyId);
    this.dropInvite(invite);
    return { kind: 'joined', party };
  }

  declineInvite(inviteId: string, decliningPlayerId: string): boolean {
    const invite = this.invites.get(inviteId);
    if (invite === undefined || invite.toPlayerId !== decliningPlayerId) {
      return false;
    }
    this.dropInvite(invite);
    return true;
  }

  /**
   * Removes a member, promotes the next member when the leader leaves, and
   * disbands the party once it is empty. Invites the leaver sent are dropped so
   * they cannot add strangers to a party the leaver no longer leads.
   */
  leave(playerId: string): PartyLeaveResult {
    const party = this.partyOf(playerId);
    if (party === undefined) {
      this.dropInvitesSentBy(playerId);
      return { party: null, formerPartyId: null };
    }
    const formerPartyId = party.partyId;
    party.memberIds = party.memberIds.filter((memberId) => memberId !== playerId);
    this.partyIdByMember.delete(playerId);
    this.dropInvitesSentBy(playerId);
    this.dropInvitesTo(playerId);

    if (party.memberIds.length === 0) {
      this.parties.delete(party.partyId);
      return { party: null, formerPartyId };
    }
    if (party.leaderId === playerId) {
      const nextLeader = party.memberIds[0];
      if (nextLeader !== undefined) {
        party.leaderId = nextLeader;
      }
    }
    return { party, formerPartyId };
  }

  /**
   * Hands leadership to another member. The party stays intact, so only the
   * roster's leader flag changes. Permission is checked here rather than in the
   * room so every caller obeys the same rule.
   */
  transferLeader(actorId: string, targetId: string): PartyLeaderChangeResult {
    const party = this.partyOf(actorId);
    if (party === undefined) {
      return { kind: 'rejected', reason: 'not_in_party' };
    }
    if (party.leaderId !== actorId) {
      return { kind: 'rejected', reason: 'not_leader' };
    }
    if (targetId === actorId) {
      return { kind: 'rejected', reason: 'target_self' };
    }
    if (!party.memberIds.includes(targetId)) {
      return { kind: 'rejected', reason: 'target_not_member' };
    }
    party.leaderId = targetId;
    return { kind: 'transferred', party };
  }

  /**
   * Removes a member on the leader's order. A leader cannot kick themselves
   * (they leave instead), so the party always keeps at least the leader. Any
   * invitation the kicked player sent is dropped for the same reason as on
   * leave: it must not pull strangers into a party they no longer belong to.
   */
  kick(actorId: string, targetId: string): PartyKickResult {
    const party = this.partyOf(actorId);
    if (party === undefined) {
      return { kind: 'rejected', reason: 'not_in_party' };
    }
    if (party.leaderId !== actorId) {
      return { kind: 'rejected', reason: 'not_leader' };
    }
    if (targetId === actorId) {
      return { kind: 'rejected', reason: 'target_self' };
    }
    if (!party.memberIds.includes(targetId)) {
      return { kind: 'rejected', reason: 'target_not_member' };
    }
    party.memberIds = party.memberIds.filter((memberId) => memberId !== targetId);
    this.partyIdByMember.delete(targetId);
    this.dropInvitesSentBy(targetId);
    this.dropInvitesTo(targetId);
    return { kind: 'kicked', party, kickedId: targetId };
  }

  /** Drops expired invitations; called from the room's maintenance interval. */
  expireInvites(): void {
    const now = this.now();
    for (const invite of [...this.invites.values()]) {
      if (invite.expiresAt <= now) {
        this.dropInvite(invite);
      }
    }
  }

  pendingInviteFor(playerId: string): PartyInviteRecord | undefined {
    const inviteId = this.inviteIdByTarget.get(playerId);
    return inviteId === undefined ? undefined : this.invites.get(inviteId);
  }

  private createParty(leaderId: string): PartyState {
    const party: PartyState = { partyId: randomUUID(), leaderId, memberIds: [leaderId] };
    this.parties.set(party.partyId, party);
    this.partyIdByMember.set(leaderId, party.partyId);
    return party;
  }

  private dropInvite(invite: PartyInviteRecord): void {
    this.invites.delete(invite.inviteId);
    if (this.inviteIdByTarget.get(invite.toPlayerId) === invite.inviteId) {
      this.inviteIdByTarget.delete(invite.toPlayerId);
    }
  }

  private dropInvitesSentBy(playerId: string): void {
    for (const invite of [...this.invites.values()]) {
      if (invite.fromPlayerId === playerId) {
        this.dropInvite(invite);
      }
    }
  }

  private dropInvitesTo(playerId: string): void {
    const inviteId = this.inviteIdByTarget.get(playerId);
    if (inviteId === undefined) {
      return;
    }
    const invite = this.invites.get(inviteId);
    if (invite !== undefined) {
      this.dropInvite(invite);
    }
  }
}
