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
  moveStop: 'move.stop',
  chatSend: 'chat.send',
  combatBasicAttack: 'combat.basicAttack',
  combatEngage: 'combat.engage',
  combatAutoAttackStart: 'combat.autoAttack.start',
  combatAutoAttackStop: 'combat.autoAttack.stop',
  skillCast: 'skill.cast',
  lootPickup: 'loot.pickup',
  inventoryEquip: 'inventory.equip',
  inventoryUnequip: 'inventory.unequip',
  inventoryUse: 'inventory.use',
  shopBuy: 'shop.buy',
  shopSell: 'shop.sell',
  questAccept: 'quest.accept',
  questClaim: 'quest.claim',
  questNavigate: 'quest.navigate',
  partyInvite: 'party.invite',
  partyAccept: 'party.accept',
  partyDecline: 'party.decline',
  partyLeave: 'party.leave',
} as const;

export const SERVER_MESSAGES = {
  commandAck: 'command.ack',
  commandRejected: 'command.rejected',
  chatMessage: 'chat.message',
  combatEvent: 'combat.event',
  combatProfile: 'combat.profile',
  combatTargetChanged: 'combat.target.changed',
  sessionTransfer: 'session.transfer',
  sessionKicked: 'session.kicked',
  systemNotice: 'system.notice',
  inventorySnapshot: 'inventory.snapshot',
  assetResult: 'asset.result',
  characterProgress: 'character.progress',
  characterLevelUp: 'character.levelUp',
  lootClaimed: 'loot.claimed',
  shopCatalog: 'shop.catalog',
  questSnapshot: 'quest.snapshot',
  questUpdate: 'quest.update',
  questNavigation: 'quest.navigation',
  partySnapshot: 'party.snapshot',
  partyInvite: 'party.invite',
} as const;

/**
 * Logical facing. The first four values keep their pre-eight-direction
 * meaning so persisted rows still decode; diagonals are appended (4–7) for
 * movement, and the presentation layer maps them onto four-direction art
 * (architecture §7.2).
 */
export const FACING = {
  north: 0,
  east: 1,
  south: 2,
  west: 3,
  northEast: 4,
  southEast: 5,
  southWest: 6,
  northWest: 7,
} as const;

export type Facing = (typeof FACING)[keyof typeof FACING];

/** Facing for a movement delta; diagonals only when both axes change. */
export function facingFromDelta(deltaX: number, deltaY: number): Facing {
  if (deltaX !== 0 && deltaY !== 0) {
    if (deltaX > 0) {
      return deltaY < 0 ? FACING.northEast : FACING.southEast;
    }
    return deltaY < 0 ? FACING.northWest : FACING.southWest;
  }
  if (deltaX !== 0) {
    return deltaX > 0 ? FACING.east : FACING.west;
  }
  return deltaY > 0 ? FACING.south : FACING.north;
}

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

/** Stops the current authoritative path; the server also ends auto-attack. */
export const moveStopCommandSchema = z
  .object({
    protocolVersion: z.number().int().positive(),
    commandId: z.uuid(),
    clientSequence: z.number().int().min(0).max(2_147_483_647),
  })
  .strict();

export type MoveStopCommand = z.infer<typeof moveStopCommandSchema>;

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

/**
 * Sent immediately before an administrator disconnects a session. The client
 * shows the reason and does not automatically reconnect (ADR-022).
 */
export const sessionKickedSchema = z
  .object({
    reason: z.string().min(1).max(200),
    kind: z.enum(['kicked', 'banned']),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type SessionKicked = z.infer<typeof sessionKickedSchema>;

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
  'DROP_LOCKED',
  'INVENTORY_FULL',
  'ITEM_NOT_USABLE',
  'ITEM_NOT_EQUIPPABLE',
  'CLASS_RESTRICTED',
  'LEVEL_TOO_LOW',
  'SLOT_EMPTY',
  'NOT_OWNER',
  'DROP_EXPIRED',
  'ALREADY_CLAIMED',
  'SAFE_ZONE',
  'CHAT_BLOCKED',
  'SHOP_UNAVAILABLE',
  'INSUFFICIENT_GOLD',
  'CANNOT_SELL',
  'NOT_SOLD_HERE',
  'INVALID_QUANTITY',
  'QUEST_UNAVAILABLE',
  'QUEST_NOT_ACTIVE',
  'QUEST_NOT_COMPLETE',
  'QUEST_ITEMS_MISSING',
  'QUEST_ALREADY_CLAIMED',
  'PARTY_SELF',
  'PARTY_TARGET_UNAVAILABLE',
  'PARTY_TARGET_BUSY',
  'PARTY_ALREADY_IN_PARTY',
  'PARTY_FULL',
  'PARTY_INVITE_EXPIRED',
  'PARTY_NOT_IN_PARTY',
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
  DROP_LOCKED: '物品仍在争夺保护中，请稍后再试',
  INVENTORY_FULL: '背包已满',
  ITEM_NOT_USABLE: '该物品现在无法使用',
  ITEM_NOT_EQUIPPABLE: '该物品不能装备',
  CLASS_RESTRICTED: '该物品不适合你的职业',
  LEVEL_TOO_LOW: '等级不足，无法使用该物品',
  SLOT_EMPTY: '该装备槽为空',
  NOT_OWNER: '该掉落暂不属于你',
  DROP_EXPIRED: '掉落已经消失',
  ALREADY_CLAIMED: '掉落已被拾取',
  SAFE_ZONE: '安全区内禁止攻击其他玩家',
  CHAT_BLOCKED: '消息包含不允许的内容',
  SHOP_UNAVAILABLE: '附近没有可交易的商人',
  INSUFFICIENT_GOLD: '金币不足',
  CANNOT_SELL: '商人不会收购这件物品',
  NOT_SOLD_HERE: '商人不出售这件物品',
  INVALID_QUANTITY: '数量不合法',
  QUEST_UNAVAILABLE: '任务当前不可接取',
  QUEST_NOT_ACTIVE: '任务尚未接取',
  QUEST_NOT_COMPLETE: '任务目标尚未完成',
  QUEST_ITEMS_MISSING: '背包中的任务物品不足',
  QUEST_ALREADY_CLAIMED: '任务奖励已经领取',
  PARTY_SELF: '不能邀请自己组队',
  PARTY_TARGET_UNAVAILABLE: '对方不在附近或已经离线',
  PARTY_TARGET_BUSY: '对方已经在队伍中',
  PARTY_ALREADY_IN_PARTY: '你已经在队伍中',
  PARTY_FULL: '队伍人数已满',
  PARTY_INVITE_EXPIRED: '组队邀请已过期或不存在',
  PARTY_NOT_IN_PARTY: '你当前不在队伍中',
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
