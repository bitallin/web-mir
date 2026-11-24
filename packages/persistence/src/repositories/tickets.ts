import { and, eq, gt, isNull } from 'drizzle-orm';

import type { Database } from '../client';
import { gameTickets } from '../schema/index';

export type CreateGameTicketInput = {
  tokenHash: string;
  accountId: string;
  characterId: string;
  realmId: string;
  expiresAt: Date;
};

export type ConsumedGameTicket = {
  accountId: string;
  characterId: string;
  realmId: string;
  expiresAt: Date;
};

export async function insertGameTicket(db: Database, input: CreateGameTicketInput): Promise<void> {
  await db.insert(gameTickets).values(input);
}

/**
 * Single-use consumption. The UPDATE itself is the concurrency boundary: a
 * second attempt matches no row once the first transaction commits.
 */
export async function consumeGameTicket(
  db: Database,
  tokenHash: string,
  consumedBy: string,
  now: Date,
): Promise<ConsumedGameTicket | undefined> {
  const [row] = await db
    .update(gameTickets)
    .set({ consumedAt: now, consumedBy })
    .where(
      and(
        eq(gameTickets.tokenHash, tokenHash),
        isNull(gameTickets.consumedAt),
        gt(gameTickets.expiresAt, now),
      ),
    )
    .returning({
      accountId: gameTickets.accountId,
      characterId: gameTickets.characterId,
      realmId: gameTickets.realmId,
      expiresAt: gameTickets.expiresAt,
    });
  return row;
}
