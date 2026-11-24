export { createDatabase } from './client';
export { pingDatabase } from './health';
export type { CreateDatabaseOptions, Database, DatabaseHandle } from './client';
export { DEFAULT_MIGRATIONS_FOLDER, runMigrations } from './migrator';

export {
  ACCOUNT_STATUSES,
  accounts,
  accountSessions,
  CHARACTER_CLASS_IDS,
  characters,
  characterSessions,
  gameTickets,
  REALM_STATUSES,
  realms,
} from './schema/index';
export type {
  Account,
  AccountSession,
  AccountStatus,
  Character,
  CharacterClassId,
  CharacterSession,
  GameTicket,
  NewAccount,
  NewCharacter,
  NewRealm,
  Realm,
  RealmStatus,
} from './schema/index';

export {
  acquireCharacterLease,
  consumeGameTicket,
  findAccountById,
  findAccountByNormalizedUsername,
  findCharacterById,
  findCharacterForAccount,
  findCharacterLease,
  findRealmById,
  findSessionByAccessHash,
  findSessionByRefreshHash,
  insertAccount,
  insertCharacter,
  insertGameTicket,
  insertSession,
  isUniqueViolation,
  listActiveRealms,
  listCharactersByAccount,
  refreshCharacterLeases,
  releaseCharacterLease,
  relocateCharactersFromMap,
  revokeSession,
  revokeSessionByAccessHash,
  rotateSession,
  saveCharacterCheckpoint,
  saveCharacterTransfer,
} from './repositories/index';
export type {
  AcquireLeaseInput,
  CharacterCheckpoint,
  CharacterTransfer,
  CharacterWithRealm,
  ConsumedGameTicket,
  CreateAccountInput,
  CreateCharacterInput,
  CreateGameTicketInput,
  CreateSessionInput,
  RelocateCharactersInput,
  SessionTokenSet,
} from './repositories/index';
