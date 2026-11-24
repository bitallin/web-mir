import { describe, expect, it } from 'vitest';

import {
  commandAckSchema,
  commandRejectedSchema,
  DEFAULT_PATCH_RATE_MS,
  DEFAULT_TICK_HZ,
  moveToCommandSchema,
  worldJoinOptionsSchema,
} from './realtime';

const validMove = {
  protocolVersion: 1,
  commandId: '0192f0a0-0000-7000-8000-000000000001',
  clientSequence: 7,
  targetTileX: 15,
  targetTileY: 10,
};

describe('moveToCommandSchema', () => {
  it('accepts an intent-only command', () => {
    const parsed = moveToCommandSchema.parse(validMove);
    expect(parsed.targetTileX).toBe(15);
  });

  it('rejects client-supplied final positions', () => {
    expect(moveToCommandSchema.safeParse({ ...validMove, x: 12_000, y: 12_000 }).success).toBe(
      false,
    );
    expect(
      moveToCommandSchema.safeParse({ ...validMove, targetX: 12_000, targetY: 12_000 }).success,
    ).toBe(false);
  });

  it('rejects malformed identifiers and out-of-range targets', () => {
    expect(moveToCommandSchema.safeParse({ ...validMove, commandId: 'nope' }).success).toBe(false);
    expect(moveToCommandSchema.safeParse({ ...validMove, targetTileX: -1 }).success).toBe(false);
    expect(moveToCommandSchema.safeParse({ ...validMove, targetTileY: 1.5 }).success).toBe(false);
    expect(
      moveToCommandSchema.safeParse({ ...validMove, clientSequence: Number.MAX_SAFE_INTEGER })
        .success,
    ).toBe(false);
  });
});

describe('worldJoinOptionsSchema', () => {
  it('accepts a development identity with CJK display name', () => {
    const parsed = worldJoinOptionsSchema.parse({
      protocolVersion: 1,
      displayName: '游侠 Alice',
      playerKey: '8f1d2c4a-9b3e-4f00-9a11-123456789abc',
    });

    expect(parsed.displayName).toBe('游侠 Alice');
  });

  it('rejects extra identity fields such as a self-reported account id', () => {
    expect(
      worldJoinOptionsSchema.safeParse({
        protocolVersion: 1,
        displayName: 'Alice',
        playerKey: '8f1d2c4a-9b3e-4f00-9a11-123456789abc',
        accountId: 'admin',
      }).success,
    ).toBe(false);
  });

  it('rejects blank and oversized display names', () => {
    expect(
      worldJoinOptionsSchema.safeParse({
        protocolVersion: 1,
        displayName: '   ',
        playerKey: '8f1d2c4a-9b3e-4f00-9a11-123456789abc',
      }).success,
    ).toBe(false);

    expect(
      worldJoinOptionsSchema.safeParse({
        protocolVersion: 1,
        displayName: 'x'.repeat(17),
        playerKey: '8f1d2c4a-9b3e-4f00-9a11-123456789abc',
      }).success,
    ).toBe(false);
  });
});

describe('server command messages', () => {
  it('accepts an acknowledgement containing the authoritative path', () => {
    const parsed = commandAckSchema.parse({
      commandId: validMove.commandId,
      clientSequence: 7,
      serverTime: 1_763_000_000_000,
      deduplicated: false,
      path: [
        { x: 15, y: 11 },
        { x: 15, y: 12 },
      ],
      speedUnitsPerSecond: 4_000,
      startX: 15_500,
      startY: 10_500,
    });

    expect(parsed.path).toHaveLength(2);
  });

  it('accepts a rejection without ids and rejects unknown codes', () => {
    expect(
      commandRejectedSchema.parse({
        code: 'INVALID_PAYLOAD',
        message: '消息格式不合法',
        serverTime: 1,
      }).code,
    ).toBe('INVALID_PAYLOAD');

    expect(
      commandRejectedSchema.safeParse({
        code: 'WHATEVER',
        message: 'x',
        serverTime: 1,
      }).success,
    ).toBe(false);
  });
});

describe('simulation defaults', () => {
  it('uses 20Hz simulation and a 10Hz patch rate', () => {
    expect(DEFAULT_TICK_HZ).toBe(20);
    expect(DEFAULT_PATCH_RATE_MS).toBe(100);
  });
});
