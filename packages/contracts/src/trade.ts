import { z } from 'zod';

import { itemKindSchema, itemQualitySchema, templateIdSchema } from './economy';

/**
 * Face-to-face trade wire contract (ADR-050). The trade session is ephemeral
 * room state; only the final settlement touches PostgreSQL. Both sides lock
 * their offer and the server settles atomically, so the browser never moves an
 * item or a coin by itself.
 */

/** An unanswered invite dies so it cannot be accepted minutes later. */
export const TRADE_INVITE_TTL_MS = 30_000;
/** Both players must stand this close on the same map. */
export const TRADE_RANGE_TILES = 3;
/** One side may offer at most this many whole item stacks. */
export const TRADE_MAX_ITEM_STACKS = 8;
/** Defensive upper bound; every offer is also checked against the wallet. */
export const TRADE_MAX_GOLD = 1_000_000;

export const TRADE_STATUSES = ['open', 'settling', 'completed', 'cancelled'] as const;
export const tradeStatusSchema = z.enum(TRADE_STATUSES);
export type TradeStatus = z.infer<typeof tradeStatusSchema>;

export const TRADE_CLOSE_REASONS = [
  'completed',
  'declined',
  'cancelled',
  'player_left',
  'player_dead',
  'out_of_range',
  'failed',
] as const;
export const tradeCloseReasonSchema = z.enum(TRADE_CLOSE_REASONS);
export type TradeCloseReason = z.infer<typeof tradeCloseReasonSchema>;

/** One whole stack as it appears in the trade panel. */
export const tradeOfferItemViewSchema = z
  .object({
    itemId: z.uuid(),
    templateId: templateIdSchema,
    name: z.string().min(1).max(24),
    kind: itemKindSchema,
    quality: itemQualitySchema.optional(),
    quantity: z.number().int().min(1).max(999),
  })
  .strict();

export type TradeOfferItemView = z.infer<typeof tradeOfferItemViewSchema>;

/**
 * Private view of one trade, always expressed from the recipient's side. The
 * recipient's own offer comes back as `self*` so the panel can render it
 * without knowing which side of the registry it is.
 */
export const tradeStateSchema = z
  .object({
    tradeId: z.uuid(),
    status: tradeStatusSchema,
    closeReason: tradeCloseReasonSchema.optional(),
    selfPlayerId: z.uuid(),
    otherPlayerId: z.uuid(),
    otherDisplayName: z.string().min(1).max(32),
    selfItems: z.array(tradeOfferItemViewSchema).max(TRADE_MAX_ITEM_STACKS),
    otherItems: z.array(tradeOfferItemViewSchema).max(TRADE_MAX_ITEM_STACKS),
    selfGold: z.number().int().min(0).max(TRADE_MAX_GOLD),
    otherGold: z.number().int().min(0).max(TRADE_MAX_GOLD),
    selfLocked: z.boolean(),
    otherLocked: z.boolean(),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type TradeState = z.infer<typeof tradeStateSchema>;

/** Sent only to the invited player. */
export const tradeInviteViewSchema = z
  .object({
    inviteId: z.uuid(),
    fromPlayerId: z.uuid(),
    fromDisplayName: z.string().min(1).max(32),
    expiresAt: z.number().nonnegative(),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type TradeInviteView = z.infer<typeof tradeInviteViewSchema>;

const tradeCommandBase = {
  protocolVersion: z.number().int().positive(),
  commandId: z.uuid(),
  clientSequence: z.number().int().min(0).max(2_147_483_647),
};

export const tradeInviteCommandSchema = z
  .object({
    ...tradeCommandBase,
    targetPlayerId: z.uuid(),
  })
  .strict();

export type TradeInviteCommand = z.infer<typeof tradeInviteCommandSchema>;

export const tradeAcceptCommandSchema = z
  .object({
    ...tradeCommandBase,
    inviteId: z.uuid(),
  })
  .strict();

export type TradeAcceptCommand = z.infer<typeof tradeAcceptCommandSchema>;

export const tradeDeclineCommandSchema = z
  .object({
    ...tradeCommandBase,
    inviteId: z.uuid(),
  })
  .strict();

export type TradeDeclineCommand = z.infer<typeof tradeDeclineCommandSchema>;

/**
 * Offers are whole stacks: the server derives each quantity from the live
 * inventory, so a client cannot invent a quantity or a template.
 */
export const tradeOfferCommandSchema = z
  .object({
    ...tradeCommandBase,
    tradeId: z.uuid(),
    itemIds: z.array(z.uuid()).max(TRADE_MAX_ITEM_STACKS),
    gold: z.number().int().min(0).max(TRADE_MAX_GOLD),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.itemIds).size !== value.itemIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['itemIds'],
        message: 'itemIds must be unique',
      });
    }
  });

export type TradeOfferCommand = z.infer<typeof tradeOfferCommandSchema>;

export const tradeLockCommandSchema = z
  .object({
    ...tradeCommandBase,
    tradeId: z.uuid(),
  })
  .strict();

export type TradeLockCommand = z.infer<typeof tradeLockCommandSchema>;

export const tradeCancelCommandSchema = z
  .object({
    ...tradeCommandBase,
    tradeId: z.uuid(),
  })
  .strict();

export type TradeCancelCommand = z.infer<typeof tradeCancelCommandSchema>;
