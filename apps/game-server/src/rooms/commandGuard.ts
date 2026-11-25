import type { CommandRejectionCode } from '@web-legend/contracts';

import type { TokenBucket } from '../world/rateLimiter';

export type CommandEnvelope = {
  commandId: string;
  clientSequence: number;
  protocolVersion: number;
};

type GuardSession = {
  transferring: boolean;
  lastSequence: number;
  rateBucket: TokenBucket;
};

export type CommandGuardResult =
  { kind: 'ok' } | { kind: 'reject'; code: CommandRejectionCode } | { kind: 'duplicate' };

/**
 * The gate every client command passes before the domain or a transaction runs:
 * transfer state, protocol version, duplicate id, sequence and rate limit, in
 * that order. Each pipeline used to copy these checks (move, combat, assets,
 * auto-attack); one implementation keeps their order and error codes identical
 * (TD-SRV-01).
 */
export class CommandGuard {
  constructor(
    private readonly options: {
      protocolVersion: number;
      windowSize: number;
      now: () => number;
    },
  ) {}

  check(
    session: GuardSession,
    command: { protocolVersion: number; clientSequence: number },
    duplicated: boolean,
  ): CommandGuardResult {
    if (session.transferring) {
      return { kind: 'reject', code: 'INVALID_SESSION' };
    }
    if (command.protocolVersion !== this.options.protocolVersion) {
      return { kind: 'reject', code: 'PROTOCOL_MISMATCH' };
    }
    if (duplicated) {
      return { kind: 'duplicate' };
    }
    if (command.clientSequence <= session.lastSequence) {
      return { kind: 'reject', code: 'STALE_SEQUENCE' };
    }
    if (!session.rateBucket.take(this.options.now())) {
      return { kind: 'reject', code: 'RATE_LIMITED' };
    }
    return { kind: 'ok' };
  }

  /** Bounded idempotency window shared by all command kinds. */
  remember<T>(window: Map<string, T>, commandId: string, value: T): void {
    window.set(commandId, value);
    if (window.size <= this.options.windowSize) {
      return;
    }
    const oldest = window.keys().next();
    if (!oldest.done) {
      window.delete(oldest.value);
    }
  }
}
