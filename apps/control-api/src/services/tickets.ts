import { createOpaqueToken, hashToken } from '@web-legend/auth';
import { GAME_TICKET_TTL_SECONDS, type GameTicketResponse } from '@web-legend/contracts';
import {
  findCharacterForAccount,
  findRealmById,
  insertGameTicket,
  type Database,
} from '@web-legend/persistence';

import { AppError } from '../http/errors';
import { toCharacterView } from './views';

/**
 * Issues the one-time credential the browser presents when joining a room.
 * The secret is returned once and only its digest is stored.
 */
export class TicketService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(accountId: string, characterId: string): Promise<GameTicketResponse> {
    const character = await findCharacterForAccount(this.db, characterId, accountId);
    if (character === undefined) {
      throw new AppError(404, 'NOT_FOUND', '角色不存在');
    }

    const realm = await findRealmById(this.db, character.realmId);
    if (realm === undefined || realm.status !== 'active') {
      throw new AppError(403, 'FORBIDDEN', '该区服当前不可进入');
    }

    const ticket = createOpaqueToken();
    const expiresAt = new Date(this.now().getTime() + GAME_TICKET_TTL_SECONDS * 1_000);
    await insertGameTicket(this.db, {
      tokenHash: hashToken(ticket),
      accountId,
      characterId,
      realmId: character.realmId,
      expiresAt,
    });

    return {
      ticket,
      expiresAt: expiresAt.toISOString(),
      character: toCharacterView(character),
    };
  }
}
