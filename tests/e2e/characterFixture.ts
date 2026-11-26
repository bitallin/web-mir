import { createDatabase } from '../../packages/persistence/src/index';

/**
 * Test-only fixture: the browser suite cannot grind enough monsters to reach
 * level 5. It writes to the throwaway E2E database, never the dev stack
 * (ADR-025), before the character joins a room.
 */
export async function setCharacterLevel(characterName: string, level: number): Promise<void> {
  const url = process.env.E2E_DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error('E2E_DATABASE_URL is required to prepare leveled characters');
  }
  const database = createDatabase(url, { max: 1 });
  try {
    const updated = await database.sql<{ id: string }[]>`
      update "public"."characters" set "level" = ${level} where "name" = ${characterName} returning "id"
    `;
    if (updated.length !== 1) {
      throw new Error(`expected one character named "${characterName}", updated ${updated.length}`);
    }
  } finally {
    await database.close();
  }
}
