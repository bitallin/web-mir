export { createDatabase } from './client';
export type { CreateDatabaseOptions, Database, DatabaseHandle } from './client';
export { DEFAULT_MIGRATIONS_FOLDER, runMigrations } from './migrator';
export { REALM_STATUSES, realms } from './schema/index';
export type { NewRealm, Realm, RealmStatus } from './schema/index';
