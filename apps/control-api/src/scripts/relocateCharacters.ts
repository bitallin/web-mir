import { STARTER_TOWN_MAP } from '@web-legend/contracts/maps';
import { createDatabase, relocateCharactersFromMap } from '@web-legend/persistence';

import { loadControlApiEnv } from '../env';

const RETIRED_MAP_IDS = ['phase1_test_map'];

/**
 * One-off maintenance command: characters created in phase 2 still reference
 * the retired technical map. Move them to the starter town spawn so they can
 * enter the phase-3 world. Safe to run repeatedly.
 */
async function main(): Promise<void> {
  const env = loadControlApiEnv();
  const database = createDatabase(env.DATABASE_URL, { max: 2 });
  const spawn = STARTER_TOWN_MAP.spawnPoints[0];
  if (spawn === undefined) {
    throw new Error('starter town has no spawn point');
  }

  try {
    let total = 0;
    for (const fromMapId of RETIRED_MAP_IDS) {
      const moved = await relocateCharactersFromMap(database.db, {
        fromMapId,
        toMapId: STARTER_TOWN_MAP.mapId,
        x: spawn.x * 1_000 + 500,
        y: spawn.y * 1_000 + 500,
        facing: 2,
      });
      total += moved;
      process.stdout.write(`relocated ${String(moved)} character(s) from ${fromMapId}\n`);
    }
    process.stdout.write(
      `done: ${String(total)} character(s) now start in ${STARTER_TOWN_MAP.mapId}\n`,
    );
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`character relocation failed: ${message}\n`);
  process.exitCode = 1;
});
