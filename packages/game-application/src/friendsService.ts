import type { CharacterClass, FriendRequestView } from '@web-legend/contracts';
import {
  acceptFriendshipRequest,
  areFriends,
  declineFriendshipRequest,
  deleteFriendshipBetween,
  findCharacterById,
  findFriendship,
  findFriendshipById,
  insertFriendshipRequest,
  isUniqueViolation,
  listAcceptedFriendIds,
  listAcceptedFriendships,
  listCharacterProfiles,
  listPendingFriendships,
  type Database,
  type Friendship,
} from '@web-legend/persistence';

import { SocialError } from './errors';

export type FriendProfile = {
  playerId: string;
  displayName: string;
  classId: CharacterClass;
  level: number;
};

/** Database facts only; the room merges process-wide presence into these. */
export type FriendRelations = {
  friends: FriendProfile[];
  incoming: FriendRequestView[];
  outgoing: FriendRequestView[];
};

export type FriendRequestOutcome = {
  requestId: string;
  addresseeId: string;
  /** True when the target had already asked, so the pair became friends. */
  autoAccepted: boolean;
};

export type FriendAcceptOutcome = {
  requestId: string;
  requesterId: string;
};

export type FriendsServiceOptions = {
  now?: () => Date;
};

/**
 * Persistent friend relations (ADR-045). Every operation is a short
 * transaction-free statement or a conditional update, so duplicate requests
 * and duplicate accepts converge instead of creating extra rows.
 */
export class FriendsService {
  private readonly now: () => Date;

  constructor(
    private readonly database: Database,
    options: FriendsServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async relations(characterId: string): Promise<FriendRelations> {
    const [accepted, pending] = await Promise.all([
      listAcceptedFriendships(this.database, characterId),
      listPendingFriendships(this.database, characterId),
    ]);
    const friendIds = accepted.map((row) => otherSide(row, characterId));
    const pendingIds = pending.map((row) => otherSide(row, characterId));
    const profiles = await listCharacterProfiles(this.database, [
      ...new Set([...friendIds, ...pendingIds]),
    ]);
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

    const friends: FriendProfile[] = [];
    for (const friendId of friendIds) {
      const profile = profileById.get(friendId);
      if (profile !== undefined) {
        friends.push(toFriendProfile(profile));
      }
    }
    friends.sort((left, right) => left.displayName.localeCompare(right.displayName));

    const toRequest = (row: Friendship): FriendRequestView => {
      const otherId = otherSide(row, characterId);
      const profile = profileById.get(otherId);
      return {
        requestId: row.id,
        playerId: otherId,
        displayName: profile?.name ?? '玩家',
        classId: (profile?.classId ?? 'warrior') as CharacterClass,
        level: profile?.level ?? 1,
        outgoing: row.requestedById === characterId,
        createdAt: row.createdAt.getTime(),
      };
    };

    return {
      friends,
      incoming: pending.filter((row) => row.requestedById !== characterId).map(toRequest),
      outgoing: pending.filter((row) => row.requestedById === characterId).map(toRequest),
    };
  }

  async request(requesterId: string, targetId: string): Promise<FriendRequestOutcome> {
    if (requesterId === targetId) {
      throw new SocialError('FRIEND_SELF');
    }
    const [requester, target] = await Promise.all([
      findCharacterById(this.database, requesterId),
      findCharacterById(this.database, targetId),
    ]);
    if (target === undefined || requester === undefined || target.realmId !== requester.realmId) {
      throw new SocialError('FRIEND_TARGET_NOT_FOUND');
    }

    const existing = await findFriendship(this.database, requesterId, targetId);
    if (existing !== undefined) {
      return this.resolveExistingRequest(existing, requesterId, targetId);
    }

    try {
      const row = await insertFriendshipRequest(this.database, requesterId, targetId, this.now());
      if (row === undefined) {
        throw new SocialError('SERVICE_UNAVAILABLE');
      }
      return { requestId: row.id, addresseeId: targetId, autoAccepted: false };
    } catch (error) {
      // Another request for the same pair won the unique index race; converge
      // on the row that now exists instead of surfacing a database error.
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const raced = await findFriendship(this.database, requesterId, targetId);
      if (raced === undefined) {
        throw new SocialError('SERVICE_UNAVAILABLE');
      }
      return this.resolveExistingRequest(raced, requesterId, targetId);
    }
  }

  async accept(playerId: string, requestId: string): Promise<FriendAcceptOutcome> {
    const row = await this.requireIncomingRequest(playerId, requestId);
    if (row.status === 'accepted') {
      return { requestId: row.id, requesterId: row.requestedById };
    }
    const updated = await acceptFriendshipRequest(this.database, requestId, playerId, this.now());
    if (updated === undefined) {
      // A concurrent accept or decline changed the row; re-read once so a
      // duplicate accept still succeeds and a declined one reports not found.
      const current = await findFriendshipById(this.database, requestId);
      if (
        current?.status === 'accepted' &&
        (current.lowCharacterId === playerId || current.highCharacterId === playerId)
      ) {
        return { requestId: current.id, requesterId: current.requestedById };
      }
      throw new SocialError('FRIEND_REQUEST_NOT_FOUND');
    }
    return { requestId: updated.id, requesterId: updated.requestedById };
  }

  async decline(playerId: string, requestId: string): Promise<FriendAcceptOutcome> {
    const row = await this.requireIncomingRequest(playerId, requestId);
    if (row.status === 'accepted') {
      throw new SocialError('FRIEND_REQUEST_NOT_FOUND');
    }
    const declined = await declineFriendshipRequest(this.database, requestId, playerId);
    if (!declined) {
      throw new SocialError('FRIEND_REQUEST_NOT_FOUND');
    }
    return { requestId: row.id, requesterId: row.requestedById };
  }

  /** Removing an already absent relation is a no-op, not an error. */
  async remove(playerId: string, friendId: string): Promise<boolean> {
    if (playerId === friendId) {
      throw new SocialError('FRIEND_SELF');
    }
    return deleteFriendshipBetween(this.database, playerId, friendId);
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    if (a === b) {
      return false;
    }
    return areFriends(this.database, a, b);
  }

  async friendIds(characterId: string): Promise<string[]> {
    return listAcceptedFriendIds(this.database, characterId);
  }

  private async resolveExistingRequest(
    existing: Friendship,
    requesterId: string,
    targetId: string,
  ): Promise<FriendRequestOutcome> {
    if (existing.status === 'accepted') {
      throw new SocialError('FRIEND_ALREADY_FRIENDS');
    }
    if (existing.requestedById === requesterId) {
      return { requestId: existing.id, addresseeId: targetId, autoAccepted: false };
    }
    // The target already asked us; asking back accepts their request.
    const updated = await acceptFriendshipRequest(
      this.database,
      existing.id,
      requesterId,
      this.now(),
    );
    if (updated === undefined) {
      throw new SocialError('FRIEND_REQUEST_NOT_FOUND');
    }
    return { requestId: updated.id, addresseeId: targetId, autoAccepted: true };
  }

  private async requireIncomingRequest(playerId: string, requestId: string): Promise<Friendship> {
    const row = await findFriendshipById(this.database, requestId);
    const participant =
      row !== undefined && (row.lowCharacterId === playerId || row.highCharacterId === playerId);
    if (row === undefined || !participant || row.requestedById === playerId) {
      throw new SocialError('FRIEND_REQUEST_NOT_FOUND');
    }
    return row;
  }
}

function otherSide(row: Friendship, characterId: string): string {
  return row.lowCharacterId === characterId ? row.highCharacterId : row.lowCharacterId;
}

function toFriendProfile(profile: {
  id: string;
  name: string;
  classId: string;
  level: number;
}): FriendProfile {
  return {
    playerId: profile.id,
    displayName: profile.name,
    classId: profile.classId as CharacterClass,
    level: profile.level,
  };
}
