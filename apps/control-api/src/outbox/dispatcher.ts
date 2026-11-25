import { adminCommandEnvelopeSchema, type AdminCommandEnvelope } from '@web-legend/contracts';
import {
  claimPendingCommands,
  markCommandApplied,
  markCommandFailed,
  scheduleCommandRetry,
  type Database,
  type OutboxEvent,
} from '@web-legend/persistence';
import type { Logger } from 'pino';

import { GameServerHttpError } from '../services/gameServerClient';
import type { GameServerGateway } from '../services/gameServerClient';

export type DispatcherOptions = {
  db: Database;
  client: GameServerGateway;
  logger: Logger;
  pollIntervalMs?: number;
  batchSize?: number;
  maxAttempts?: number;
  now?: () => Date;
};

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Reliable delivery for administrator commands (ADR-022). PostgreSQL holds the
 * intent; this loop only transports it. A crash after `dispatched` is recovered
 * by re-claiming stale rows, and the game server deduplicates by command id.
 */
export class AdminCommandDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly options: DispatcherOptions) {}

  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      this.kick();
    }, this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    this.timer.unref();
    this.kick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.running;
  }

  /** One claim-and-dispatch pass; exported for integration tests. */
  async runOnce(): Promise<number> {
    const now = this.now();
    const rows = await claimPendingCommands(this.options.db, {
      now,
      limit: this.options.batchSize ?? DEFAULT_BATCH_SIZE,
      staleDispatchedBefore: new Date(now.getTime() - 60_000),
    });
    for (const row of rows) {
      await this.deliver(row);
    }
    return rows.length;
  }

  private kick(): void {
    if (this.running !== null || this.stopped) {
      return;
    }
    this.running = this.runOnce()
      .then(() => undefined)
      .catch((error: unknown) => {
        this.options.logger.error({ err: error }, 'admin command dispatcher pass failed');
      })
      .finally(() => {
        this.running = null;
      });
  }

  private async deliver(row: OutboxEvent): Promise<void> {
    const command = this.toCommand(row);
    if (command === null) {
      await markCommandFailed(this.options.db, row.id, 'invalid outbox payload');
      this.options.logger.error(
        { outboxId: row.id, type: row.type },
        'admin command payload is invalid',
      );
      return;
    }

    try {
      const receipt = await this.options.client.dispatch(command);
      await markCommandApplied(this.options.db, row.id, this.now());
      this.options.logger.info(
        {
          outboxId: row.id,
          commandId: row.commandId,
          type: row.type,
          applied: receipt.applied,
          duplicate: receipt.status === 'duplicate',
        },
        'admin command applied',
      );
    } catch (error) {
      const attempts = row.attempts;
      const maxAttempts = this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
      const message = error instanceof Error ? error.message : String(error);

      if (
        error instanceof GameServerHttpError &&
        error.statusCode >= 400 &&
        error.statusCode < 500
      ) {
        await markCommandFailed(this.options.db, row.id, message);
        this.options.logger.error(
          { outboxId: row.id, type: row.type, statusCode: error.statusCode },
          'admin command rejected by game server',
        );
        return;
      }

      if (attempts >= maxAttempts) {
        await markCommandFailed(this.options.db, row.id, message);
        this.options.logger.error(
          { outboxId: row.id, type: row.type, attempts },
          'admin command exhausted retries',
        );
        return;
      }

      const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
      await scheduleCommandRetry(
        this.options.db,
        row.id,
        message,
        new Date(this.now().getTime() + delayMs),
      );
      this.options.logger.warn(
        { outboxId: row.id, type: row.type, attempts, delayMs },
        'admin command delivery failed; scheduled retry',
      );
    }
  }

  private toCommand(row: OutboxEvent): AdminCommandEnvelope | null {
    const base = {
      commandId: row.commandId,
      reason: row.reason,
      issuedAt: row.createdAt.toISOString(),
    };
    let candidate: unknown;
    switch (row.type) {
      case 'kick':
        candidate = { ...base, type: 'kick', characterId: row.targetId };
        break;
      case 'ban':
        candidate = { ...base, type: 'ban', accountId: row.targetId };
        break;
      case 'mute': {
        const payload = row.payload;
        const mutedUntil =
          typeof payload === 'object' &&
          payload !== null &&
          'mutedUntil' in payload &&
          typeof payload.mutedUntil === 'string'
            ? payload.mutedUntil
            : null;
        if (mutedUntil === null) {
          return null;
        }
        candidate = { ...base, type: 'mute', accountId: row.targetId, mutedUntil };
        break;
      }
    }
    const parsed = adminCommandEnvelopeSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
