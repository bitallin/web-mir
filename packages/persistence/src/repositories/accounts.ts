import { eq } from 'drizzle-orm';

import type { Database } from '../client';
import { accounts, type Account } from '../schema/index';

export type CreateAccountInput = {
  username: string;
  usernameNormalized: string;
  passwordHash: string;
};

export async function insertAccount(db: Database, input: CreateAccountInput): Promise<Account> {
  const [account] = await db.insert(accounts).values(input).returning();
  if (account === undefined) {
    throw new Error('account insert returned no row');
  }
  return account;
}

export async function findAccountByNormalizedUsername(
  db: Database,
  usernameNormalized: string,
): Promise<Account | undefined> {
  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.usernameNormalized, usernameNormalized))
    .limit(1);
  return account;
}

export async function findAccountById(db: Database, id: string): Promise<Account | undefined> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return account;
}

const UNIQUE_VIOLATION_SQLSTATE = '23505';

function hasUniqueViolationCode(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Object.getOwnPropertyDescriptor(value, 'code')?.value === UNIQUE_VIOLATION_SQLSTATE;
}

/**
 * Drizzle wraps driver errors, so the SQLSTATE may live on a `cause` chain
 * rather than on the thrown value itself.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (hasUniqueViolationCode(current)) {
      return true;
    }
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    current = Object.getOwnPropertyDescriptor(current, 'cause')?.value;
    if (current === undefined) {
      return false;
    }
  }
  return false;
}
