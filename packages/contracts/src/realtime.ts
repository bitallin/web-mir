import { z } from 'zod';

import { tilePointSchema } from './map';

/** Both sides read positions as integer sub-tile units. */
export const TILE_UNITS = 1000 as const;
export const DEFAULT_TICK_HZ = 20 as const;
/**
 * State patches run at the simulation rate in phase 3. The architecture's
 * initial 10Hz value left too little margin for the 250ms visibility gate once
 * AOI views encode per client; phase 8 re-evaluates bandwidth at 30/50 players.
 */
export const DEFAULT_PATCH_RATE_MS = 50 as const;
export const PLAYER_SPEED_UNITS_PER_SECOND = 4_000 as const;

export const CLIENT_MESSAGES = {
  moveTo: 'move.to',
  chatSend: 'chat.send',
  combatBasicAttack: 'combat.basicAttack',
  skillCast: 'skill.cast',
  lootPickup: 'loot.pickup',
  inventoryEquip: 'inventory.equip',
  inventoryUnequip: 'inventory.unequip',
  inventoryUse: 'inventory.use',
} as const;

export const SERVER_MESSAGES = {
  commandAck: 'command.ack',
  commandRejected: 'command.rejected',
  chatMessage: 'chat.message',
  combatEvent: 'combat.event',
  combatProfile: 'combat.profile',
  sessionTransfer: 'session.transfer',
  systemNotice: 'system.notice',
  inventorySnapshot: 'inventory.snapshot',
  assetResult: 'asset.result',
  characterProgress: 'character.progress',
  characterLevelUp: 'character.levelUp',
  lootClaimed: 'loot.claimed',
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

export const CHAT_MESSAGE_MAX_LENGTH = 120 as const;

/**
 * Chat is not an asset operation, but it still carries a client-generated id so
 * a duplicate delivery inside one session is dropped instead of being broadcast
 * twice.
 */
export const chatSendSchema = z
  .object({
    protocolVersion: z.number().int().positive(),
    clientMessageId: z.uuid(),
    message: z
      .string()
      .min(1)
      .max(CHAT_MESSAGE_MAX_LENGTH)
      .refine((value) => value.trim().length > 0, 'message must not be blank')
      .refine(
        (value) =>
          [...value].every((character) => {
            const code = character.codePointAt(0) ?? 0;
            return code >= 0x20 && code !== 0x7f;
          }),
        { message: 'message contains control characters' },
      ),
  })
  .strict();

export type ChatSend = z.infer<typeof chatSendSchema>;

export const chatMessageSchema = z
  .object({
    messageId: z.uuid(),
    playerId: z.uuid(),
    displayName: z.string().min(1).max(32),
    message: z.string().min(1).max(CHAT_MESSAGE_MAX_LENGTH),
    channel: z.literal('map'),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/**
 * Sent only after the server has persisted the character's new map and released
 * the old lease. The browser must fetch a fresh ticket and join the room for
 * `mapId`; it cannot choose the destination itself.
 */
export const sessionTransferSchema = z
  .object({
    mapId: z
      .string()
      .min(3)
      .max(32)
      .regex(/^[a-z][a-z0-9_]*$/),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type SessionTransfer = z.infer<typeof sessionTransferSchema>;

export const COMMAND_REJECTION_CODES = [
  'INVALID_PAYLOAD',
  'PROTOCOL_MISMATCH',
  'INVALID_SESSION',
  'STALE_SEQUENCE',
  'RATE_LIMITED',
  'INVALID_TARGET',
  'UNREACHABLE',
  'OUT_OF_RANGE',
  'COOLDOWN',
  'INSUFFICIENT_RESOURCE',
  'TARGET_DEAD',
  'PLAYER_DEAD',
  'ITEM_NOT_FOUND',
  'INVENTORY_FULL',
  'ITEM_NOT_USABLE',
  'ITEM_NOT_EQUIPPABLE',
  'CLASS_RESTRICTED',
  'LEVEL_TOO_LOW',
  'SLOT_EMPTY',
  'NOT_OWNER',
  'DROP_EXPIRED',
  'ALREADY_CLAIMED',
  'SERVICE_UNAVAILABLE',
] as const;

export const commandRejectionCodeSchema = z.enum(COMMAND_REJECTION_CODES);
export type CommandRejectionCode = z.infer<typeof commandRejectionCodeSchema>;

export const COMMAND_REJECTION_MESSAGES: Record<CommandRejectionCode, string> = {
  INVALID_PAYLOAD: '消息格式不合法',
  PROTOCOL_MISMATCH: '客户端协议版本不匹配，请刷新',
  INVALID_SESSION: '会话无效，请重新连接',
  STALE_SEQUENCE: '指令序号过期',
  RATE_LIMITED: '操作过于频繁',
  INVALID_TARGET: '目标不可攻击',
  UNREACHABLE: '目标位置不可到达',
  OUT_OF_RANGE: '目标距离太远',
  COOLDOWN: '技能尚未就绪',
  INSUFFICIENT_RESOURCE: '法力不足',
  TARGET_DEAD: '目标已经死亡',
  PLAYER_DEAD: '角色已经倒下',
  ITEM_NOT_FOUND: '物品或掉落不存在',
  INVENTORY_FULL: '背包已满',
  ITEM_NOT_USABLE: '该物品现在无法使用',
  ITEM_NOT_EQUIPPABLE: '该物品不能装备',
  CLASS_RESTRICTED: '该物品不适合你的职业',
  LEVEL_TOO_LOW: '等级不足，无法使用该物品',
  SLOT_EMPTY: '该装备槽为空',
  NOT_OWNER: '该掉落暂不属于你',
  DROP_EXPIRED: '掉落已经消失',
  ALREADY_CLAIMED: '掉落已被拾取',
  SERVICE_UNAVAILABLE: '资产服务暂不可用，请稍后重试',
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
    /** Present for COOLDOWN so the client can align its local countdown. */
    retryAfterMs: z.number().int().nonnegative().optional(),
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
