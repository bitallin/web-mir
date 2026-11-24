import { z } from 'zod';

import { tilePointSchema } from './map';

/** Both sides read positions as integer sub-tile units. */
export const TILE_UNITS = 1000 as const;
export const DEFAULT_TICK_HZ = 20 as const;
export const DEFAULT_PATCH_RATE_MS = 100 as const;
export const PLAYER_SPEED_UNITS_PER_SECOND = 4_000 as const;

export const WORLD_ROOM_NAME = 'world_map' as const;

export const CLIENT_MESSAGES = {
  moveTo: 'move.to',
} as const;

export const SERVER_MESSAGES = {
  commandAck: 'command.ack',
  commandRejected: 'command.rejected',
  systemNotice: 'system.notice',
} as const;

export const FACING = {
  north: 0,
  east: 1,
  south: 2,
  west: 3,
} as const;

export type Facing = (typeof FACING)[keyof typeof FACING];

/**
 * Realtime join carries only a one-time ticket issued by the Control API.
 * Account, character and realm identity come from the server-side ticket row,
 * never from client-supplied fields (ADR-017).
 */
export const worldJoinOptionsSchema = z
  .object({
    protocolVersion: z.number().int().positive(),
    ticket: z
      .string()
      .min(32)
      .max(512)
      .regex(/^[A-Za-z0-9_-]+$/u, 'invalid ticket'),
  })
  .strict();

export type WorldJoinOptions = z.infer<typeof worldJoinOptionsSchema>;

export const moveToCommandSchema = z
  .object({
    protocolVersion: z.number().int().positive(),
    commandId: z.uuid(),
    clientSequence: z.number().int().min(0).max(2_147_483_647),
    targetTileX: z.number().int().min(0).max(1023),
    targetTileY: z.number().int().min(0).max(1023),
  })
  .strict();

export type MoveToCommand = z.infer<typeof moveToCommandSchema>;

export const COMMAND_REJECTION_CODES = [
  'INVALID_PAYLOAD',
  'PROTOCOL_MISMATCH',
  'INVALID_SESSION',
  'STALE_SEQUENCE',
  'RATE_LIMITED',
  'INVALID_TARGET',
  'UNREACHABLE',
] as const;

export const commandRejectionCodeSchema = z.enum(COMMAND_REJECTION_CODES);
export type CommandRejectionCode = z.infer<typeof commandRejectionCodeSchema>;

export const COMMAND_REJECTION_MESSAGES: Record<CommandRejectionCode, string> = {
  INVALID_PAYLOAD: '消息格式不合法',
  PROTOCOL_MISMATCH: '客户端协议版本不匹配，请刷新',
  INVALID_SESSION: '会话无效，请重新连接',
  STALE_SEQUENCE: '指令序号过期',
  RATE_LIMITED: '操作过于频繁',
  INVALID_TARGET: '目标位置不可到达',
  UNREACHABLE: '目标位置不可到达',
};

export const commandAckSchema = z
  .object({
    commandId: z.uuid(),
    clientSequence: z.number().int().nonnegative(),
    serverTime: z.number().nonnegative(),
    deduplicated: z.boolean(),
    /** Tile centers from the server's authoritative start position to the target, excluding the start. */
    path: z.array(tilePointSchema).max(4_096),
    speedUnitsPerSecond: z.number().int().positive(),
    startX: z.number().int().nonnegative(),
    startY: z.number().int().nonnegative(),
  })
  .strict();

export type CommandAck = z.infer<typeof commandAckSchema>;

export const commandRejectedSchema = z
  .object({
    commandId: z.uuid().optional(),
    clientSequence: z.number().int().nonnegative().optional(),
    code: commandRejectionCodeSchema,
    message: z.string().min(1),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type CommandRejected = z.infer<typeof commandRejectedSchema>;

export const systemNoticeSchema = z
  .object({
    kind: z.enum(['info', 'warning', 'error']),
    message: z.string().min(1).max(200),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type SystemNotice = z.infer<typeof systemNoticeSchema>;
