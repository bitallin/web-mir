/**
 * Outbox retry and duplicate-delivery drill (ADR-023).
 *
 * 1. Insert a real admin command row.
 * 2. Run the dispatcher against an unreachable Game Server: the row must stay
 *    pending with an error and a future retry time.
 * 3. Start a real Game Server and run the dispatcher again: the row must be
 *    applied.
 * 4. Inspect the row and the game server's idempotency store.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';

import { AdminCommandDispatcher } from '../../apps/control-api/src/outbox/dispatcher';
import { GameServerClient } from '../../apps/control-api/src/services/gameServerClient';
import type { GameServerEnv } from '../../apps/game-server/src/env';
import { createGameServer, type GameServerRuntime } from '../../apps/game-server/src/server';
import { createLogger } from '../../packages/observability/src/index';
import { createDatabase, insertOutboxEvent } from '../../packages/persistence/src/index';

type OutboxRow = {
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: Date | string;
  applied_at: Date | string | null;
};

function timeOf(value: Date | string | null): number | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const TOKEN = 'outbox-drill-internal-token-123';

async function reservePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('failed to reserve a port'));
        return;
      }
      const { port } = address;
      probe.close((error) => (error === undefined ? resolve(port) : reject(error)));
    });
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required');
  }
  const database = createDatabase(databaseUrl, { max: 4 });
  const logger = createLogger({
    service: 'outbox-drill',
    level: 'silent',
    destination: { write: () => undefined },
  });
  const commandId = randomUUID();
  const targetId = randomUUID();
  const port = await reservePort();
  let runtime: GameServerRuntime | undefined;

  try {
    await insertOutboxEvent(database.db, {
      commandId,
      type: 'kick',
      targetType: 'character',
      targetId,
      targetName: 'outbox-drill-target',
      payload: {},
      reason: 'outbox retry drill',
      actorAdminId: null,
      actorUsername: 'drill',
      auditLogId: null,
      createdAt: new Date(),
    });

    const unreachable = new AdminCommandDispatcher({
      db: database.db,
      client: new GameServerClient('http://127.0.0.1:1', TOKEN),
      logger,
      maxAttempts: 5,
      now: () => new Date(),
    });
    await unreachable.runOnce();

    const [afterFailure] = await database.sql.unsafe<OutboxRow[]>(
      `select status, attempts, last_error, next_attempt_at, applied_at
         from outbox_events where command_id = $1 limit 1`,
      [commandId],
    );
    if (afterFailure === undefined || afterFailure.status !== 'pending') {
      throw new Error(`expected a pending row after failure, got ${String(afterFailure?.status)}`);
    }
    if (afterFailure.attempts !== 1 || afterFailure.last_error === null) {
      throw new Error('expected one failed attempt with an error message');
    }
    if ((timeOf(afterFailure.next_attempt_at) ?? 0) <= Date.now()) {
      throw new Error('expected a future retry time after failure');
    }

    const env: GameServerEnv = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      GAME_SERVER_HOST: '127.0.0.1',
      GAME_SERVER_PORT: port,
      DATABASE_URL: databaseUrl,
      GAME_SERVER_ID: 'outbox-drill-server',
      GAME_SERVER_REALM: 'classic-01',
      INTERNAL_ADMIN_TOKEN: TOKEN,
    };
    runtime = createGameServer({ env, logger, database: database.db });
    await runtime.listen();

    const reachable = new AdminCommandDispatcher({
      db: database.db,
      client: new GameServerClient(`http://127.0.0.1:${String(port)}`, TOKEN),
      logger,
      // Skip the backoff window recorded by the failed attempt.
      now: () => new Date(Date.now() + 60 * 60 * 1000),
    });
    await reachable.runOnce();

    const [afterDelivery] = await database.sql.unsafe<OutboxRow[]>(
      `select status, attempts, last_error, next_attempt_at, applied_at
         from outbox_events where command_id = $1 limit 1`,
      [commandId],
    );
    if (afterDelivery === undefined || afterDelivery.status !== 'applied') {
      throw new Error(`expected an applied row, got ${String(afterDelivery?.status)}`);
    }

    // Duplicate delivery: the same commandId must not run twice.
    const direct = new GameServerClient(`http://127.0.0.1:${String(port)}`, TOKEN);
    const duplicateId = randomUUID();
    const envelope = {
      commandId: duplicateId,
      type: 'kick' as const,
      characterId: randomUUID(),
      reason: 'duplicate delivery drill',
      issuedAt: new Date().toISOString(),
    };
    const firstDelivery = await direct.dispatch(envelope);
    const secondDelivery = await direct.dispatch(envelope);
    if (firstDelivery.status !== 'applied' || firstDelivery.applied !== 0) {
      throw new Error(`expected an applied no-op kick, got ${JSON.stringify(firstDelivery)}`);
    }
    if (secondDelivery.status !== 'duplicate' || secondDelivery.applied !== 0) {
      throw new Error(`expected a duplicate receipt, got ${JSON.stringify(secondDelivery)}`);
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          commandId,
          failedAttempt: {
            status: afterFailure.status,
            attempts: afterFailure.attempts,
            lastError: afterFailure.last_error,
          },
          delivered: {
            status: afterDelivery.status,
            attempts: afterDelivery.attempts,
            appliedAt:
              afterDelivery.applied_at === null
                ? null
                : new Date(afterDelivery.applied_at).toISOString(),
          },
          duplicateDelivery: {
            first: { status: firstDelivery.status, applied: firstDelivery.applied },
            second: { status: secondDelivery.status, applied: secondDelivery.applied },
          },
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write('outbox retry drill passed\n');
  } finally {
    await runtime?.shutdown();
    await database.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`outbox drill failed: ${String(error)}\n`);
  process.exitCode = 1;
});
