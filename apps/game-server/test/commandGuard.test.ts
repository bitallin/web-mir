import { describe, expect, it } from 'vitest';

import { CommandGuard } from '../src/rooms/commandGuard';
import { createTokenBucket } from '../src/world/rateLimiter';

const PROTOCOL = 1;

function guard(now = 1_000): CommandGuard {
  return new CommandGuard({ protocolVersion: PROTOCOL, windowSize: 2, now: () => now });
}

function session(overrides: Partial<{ transferring: boolean; lastSequence: number }> = {}) {
  return {
    transferring: overrides.transferring ?? false,
    lastSequence: overrides.lastSequence ?? -1,
    rateBucket: createTokenBucket({ capacity: 2, refillPerSecond: 0.001, startMs: 0 }),
  };
}

function command(overrides: Partial<{ protocolVersion: number; clientSequence: number }> = {}) {
  return {
    protocolVersion: overrides.protocolVersion ?? PROTOCOL,
    clientSequence: overrides.clientSequence ?? 0,
  };
}

describe('CommandGuard', () => {
  it('rejects commands from a transferring session before other checks', () => {
    expect(guard().check(session({ transferring: true }), command(), false)).toEqual({
      kind: 'reject',
      code: 'INVALID_SESSION',
    });
  });

  it('rejects protocol mismatches before duplicate replay', () => {
    expect(guard().check(session(), command({ protocolVersion: 2 }), true)).toEqual({
      kind: 'reject',
      code: 'PROTOCOL_MISMATCH',
    });
  });

  it('reports a duplicate id without consuming a rate token', () => {
    const bucket = createTokenBucket({ capacity: 1, refillPerSecond: 0.001, startMs: 0 });
    const subject = { transferring: false, lastSequence: 5, rateBucket: bucket };
    const instance = guard();
    expect(instance.check(subject, command({ clientSequence: 6 }), true)).toEqual({
      kind: 'duplicate',
    });
    expect(instance.check(subject, command({ clientSequence: 6 }), false)).toEqual({ kind: 'ok' });
    expect(instance.check(subject, command({ clientSequence: 7 }), false)).toEqual({
      kind: 'reject',
      code: 'RATE_LIMITED',
    });
  });

  it('rejects stale sequences before consuming a rate token', () => {
    const subject = session({ lastSequence: 5 });
    expect(guard().check(subject, command({ clientSequence: 5 }), false)).toEqual({
      kind: 'reject',
      code: 'STALE_SEQUENCE',
    });
    expect(guard().check(subject, command({ clientSequence: 6 }), false)).toEqual({ kind: 'ok' });
  });

  it('keeps the idempotency window bounded', () => {
    const instance = guard();
    const window = new Map<string, number>();
    instance.remember(window, 'a', 1);
    instance.remember(window, 'b', 2);
    instance.remember(window, 'c', 3);
    expect([...window.keys()]).toEqual(['b', 'c']);
  });
});
