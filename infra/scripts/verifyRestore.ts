/**
 * Backup manifest and restore verification (ADR-023).
 *
 *   tsx infra/scripts/verifyRestore.ts --manifest backup.manifest.json <source-url>
 *   tsx infra/scripts/verifyRestore.ts --check backup.manifest.json <restored-url>
 *
 * The manifest is captured from the source at backup time so a later restore
 * is compared against the snapshot, not against a database that kept moving.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { createDatabase, type DatabaseHandle } from '../../packages/persistence/src/index';

type Row = Record<string, unknown>;

export type RestoreManifest = {
  capturedAt: string;
  tables: number;
  migrations: { count: number; lastHash: string | null; lastCreatedAt: string | null };
  rowCounts: Record<string, number>;
  invariants: {
    walletLedgerMismatches: number;
    groundWithoutDrop: number;
    nonGroundWithDrop: number;
    invalidItemPlacement: number;
    duplicateWalletRows: number;
  };
  activeContent: { realm: string; version: string; checksum: string }[];
};

const CORE_TABLES = [
  'accounts',
  'characters',
  'character_sessions',
  'game_tickets',
  'item_instances',
  'world_drops',
  'wallets',
  'currency_ledger',
  'asset_commands',
  'admin_users',
  'admin_audit_logs',
  'outbox_events',
  'content_releases',
  'content_activations',
  'realm_active_content',
  'realms',
] as const;

async function scalar(handle: DatabaseHandle, query: string): Promise<number> {
  const rows = await handle.sql.unsafe<Row[]>(query);
  const value = rows[0]?.['value'] ?? rows[0]?.['count'] ?? 0;
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value);
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return 0;
}

async function tableCount(handle: DatabaseHandle): Promise<number> {
  return scalar(
    handle,
    `select count(*)::int as value from information_schema.tables where table_schema = 'public'`,
  );
}

function renderCell(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

async function migrationInfo(handle: DatabaseHandle): Promise<RestoreManifest['migrations']> {
  try {
    const rows = await handle.sql.unsafe<Row[]>(
      `select count(*)::int as value from drizzle.__drizzle_migrations`,
    );
    const count = Number(rows[0]?.['value'] ?? 0);
    const latest = await handle.sql.unsafe<Row[]>(
      `select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`,
    );
    return {
      count,
      lastHash: renderCell(latest[0]?.['hash']),
      lastCreatedAt: renderCell(latest[0]?.['created_at']),
    };
  } catch {
    return { count: 0, lastHash: null, lastCreatedAt: null };
  }
}

async function collect(handle: DatabaseHandle): Promise<RestoreManifest> {
  const rowCounts: Record<string, number> = {};
  for (const table of CORE_TABLES) {
    rowCounts[table] = await scalar(handle, `select count(*)::int as value from "${table}"`);
  }

  const activeRows = await handle.sql.unsafe<Row[]>(
    `select r.code as realm, cr.version as version, cr.checksum as checksum
       from realm_active_content rac
       join realms r on r.id = rac.realm_id
       join content_releases cr on cr.id = rac.content_release_id
      order by r.code`,
  );

  return {
    capturedAt: new Date().toISOString(),
    tables: await tableCount(handle),
    migrations: await migrationInfo(handle),
    rowCounts,
    invariants: {
      walletLedgerMismatches: await scalar(
        handle,
        `select count(*)::int as value
           from wallets w
          where w.balance <> coalesce(
            (select sum(l.delta) from currency_ledger l where l.character_id = w.character_id), 0
          )`,
      ),
      groundWithoutDrop: await scalar(
        handle,
        `select count(*)::int as value
           from item_instances i
          where i.container = 'ground'
            and not exists (select 1 from world_drops d where d.item_instance_id = i.id)`,
      ),
      // A claimed drop keeps its world_drops row for history while the item
      // moves to a bag; only *open* drops must still be on the ground.
      nonGroundWithDrop: await scalar(
        handle,
        `select count(*)::int as value
           from item_instances i
           join world_drops d on d.item_instance_id = i.id
          where i.container <> 'ground' and d.claimed_at is null`,
      ),
      invalidItemPlacement: await scalar(
        handle,
        `select count(*)::int as value
           from item_instances
          where not (
            (container = 'inventory' and character_id is not null and slot_index is not null and equip_slot is null)
            or (container = 'equipment' and character_id is not null and equip_slot is not null and slot_index is null)
            or (container = 'ground' and character_id is null and slot_index is null and equip_slot is null)
          )`,
      ),
      duplicateWalletRows: await scalar(
        handle,
        `select count(*)::int as value
           from (select character_id from wallets group by character_id having count(*) > 1) dup`,
      ),
    },
    activeContent: activeRows.map((row) => ({
      realm: String(row['realm']),
      version: String(row['version']),
      checksum: String(row['checksum']),
    })),
  };
}

function compare(manifest: RestoreManifest, restored: RestoreManifest): string[] {
  const problems: string[] = [];
  if (manifest.tables !== restored.tables) {
    problems.push(`table count ${String(restored.tables)} != ${String(manifest.tables)}`);
  }
  if (manifest.migrations.count !== restored.migrations.count) {
    problems.push(
      `migration count ${String(restored.migrations.count)} != ${String(manifest.migrations.count)}`,
    );
  }
  for (const [table, expected] of Object.entries(manifest.rowCounts)) {
    const actual = restored.rowCounts[table] ?? -1;
    if (actual !== expected) {
      problems.push(`row count ${table}: ${String(actual)} != ${String(expected)}`);
    }
  }
  for (const [name, expected] of Object.entries(manifest.invariants)) {
    const actual = restored.invariants[name as keyof RestoreManifest['invariants']];
    if (actual !== expected) {
      problems.push(`invariant ${name}: ${String(actual)} != ${String(expected)}`);
    }
    if (actual !== 0) {
      problems.push(`invariant ${name} is not zero (${String(actual)})`);
    }
  }
  if (JSON.stringify(manifest.activeContent) !== JSON.stringify(restored.activeContent)) {
    problems.push('active content rows differ');
  }
  return problems;
}

async function main(): Promise<void> {
  const [mode, manifestPath, url] = process.argv.slice(2);
  if (mode === undefined || manifestPath === undefined || url === undefined) {
    throw new Error('usage: verifyRestore.ts --manifest <file> <url> | --check <file> <url>');
  }
  const handle = createDatabase(url, { max: 2 });
  try {
    if (mode === '--manifest') {
      const manifest = await collect(handle);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      const digest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
      process.stdout.write(
        `manifest ${manifestPath}: tables=${String(manifest.tables)} migrations=${String(
          manifest.migrations.count,
        )} accounts=${String(manifest.rowCounts['accounts'] ?? 0)} digest=${digest.slice(0, 16)}\n`,
      );
      return;
    }

    if (mode === '--check') {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as RestoreManifest;
      const restored = await collect(handle);
      const problems = compare(manifest, restored);
      process.stdout.write(
        `${JSON.stringify({ restoredAt: restored.capturedAt, problems, rowCounts: restored.rowCounts }, null, 2)}\n`,
      );
      if (problems.length > 0) {
        process.exitCode = 1;
      }
      return;
    }

    throw new Error(`unknown mode "${mode}"`);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`restore verification failed: ${String(error)}\n`);
  process.exitCode = 1;
});
