import { z } from 'zod';

import { contentIdSchema, questRepeatSchema } from './content';
import { mapIdSchema } from './mapRuntime';

/**
 * Quest wire contract. The server owns progression and rewards: the browser
 * only asks to accept or claim, and renders the snapshot it is given (ADR-034).
 * Quest definitions live in the content bundle; this file carries only the
 * per-character state and the display fields resolved from that content.
 */

/** A quest giver can be used from this many tiles away, like a merchant. */
export const QUEST_NPC_RANGE_TILES = 3 as const;

export const QUEST_STATUSES = ['locked', 'available', 'active', 'completed', 'claimed'] as const;
export const questStatusSchema = z.enum(QUEST_STATUSES);
export type QuestStatus = z.infer<typeof questStatusSchema>;

export const QUEST_OBJECTIVE_KINDS = ['kill', 'collect'] as const;

export const questKillObjectiveViewSchema = z
  .object({
    kind: z.literal('kill'),
    monsterId: contentIdSchema,
    monsterName: z.string().min(1).max(24),
    count: z.number().int().min(1).max(999),
  })
  .strict();

export const questCollectObjectiveViewSchema = z
  .object({
    kind: z.literal('collect'),
    templateId: contentIdSchema,
    itemName: z.string().min(1).max(24),
    count: z.number().int().min(1).max(999),
  })
  .strict();

export const questObjectiveViewSchema = z.discriminatedUnion('kind', [
  questKillObjectiveViewSchema,
  questCollectObjectiveViewSchema,
]);

export type QuestKillObjectiveView = z.infer<typeof questKillObjectiveViewSchema>;
export type QuestCollectObjectiveView = z.infer<typeof questCollectObjectiveViewSchema>;
export type QuestObjectiveView = z.infer<typeof questObjectiveViewSchema>;

export const questRewardItemViewSchema = z
  .object({
    templateId: contentIdSchema,
    name: z.string().min(1).max(24),
    quantity: z.number().int().min(1).max(100),
  })
  .strict();

export type QuestRewardItemView = z.infer<typeof questRewardItemViewSchema>;

export const questRewardsViewSchema = z
  .object({
    exp: z.number().int().nonnegative(),
    gold: z.number().int().nonnegative(),
    items: z.array(questRewardItemViewSchema).max(6),
  })
  .strict();

export type QuestRewardsView = z.infer<typeof questRewardsViewSchema>;

export const questViewSchema = z
  .object({
    questId: contentIdSchema,
    title: z.string().min(1).max(24),
    description: z.string().min(1).max(200),
    giverNpcId: z.string().min(3).max(32),
    giverNpcName: z.string().min(1).max(32),
    levelRequirement: z.number().int().min(1).max(100),
    prerequisiteQuestId: contentIdSchema.optional(),
    prerequisiteTitle: z.string().min(1).max(24).optional(),
    /** Present only for repeatable quests (ADR-038). */
    repeat: questRepeatSchema.optional(),
    /** Epoch millis of the next realm reset; present exactly when `repeat` is set. */
    nextResetAt: z.number().int().nonnegative().optional(),
    status: questStatusSchema,
    /**
     * Recorded progress: kills for a kill objective, items currently in the bag
     * for a collect objective. Always 0 for locked/available quests.
     */
    progress: z.number().int().min(0).max(999),
    objective: questObjectiveViewSchema,
    rewards: questRewardsViewSchema,
  })
  .strict();

export type QuestView = z.infer<typeof questViewSchema>;

export const questSnapshotSchema = z
  .object({
    quests: z.array(questViewSchema).max(64),
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type QuestSnapshot = z.infer<typeof questSnapshotSchema>;

/** A single quest changed after a committed accept, kill or claim. */
export const questUpdateSchema = z
  .object({
    quest: questViewSchema,
    serverTime: z.number().nonnegative(),
  })
  .strict();

export type QuestUpdate = z.infer<typeof questUpdateSchema>;

const questCommandBase = {
  protocolVersion: z.number().int().positive(),
  commandId: z.uuid(),
  clientSequence: z.number().int().min(0).max(2_147_483_647),
};

export const questAcceptSchema = z
  .object({
    ...questCommandBase,
    questId: contentIdSchema,
  })
  .strict();

export type QuestAccept = z.infer<typeof questAcceptSchema>;

export const questClaimSchema = z
  .object({
    ...questCommandBase,
    questId: contentIdSchema,
  })
  .strict();

export type QuestClaim = z.infer<typeof questClaimSchema>;

/**
 * One-click quest guidance (ADR-039). The client only states the intent; the
 * server owns the route, the target choice and the actual movement.
 */
export const QUEST_NAVIGATION_PURPOSES = ['hunt', 'return', 'accept', 'stop'] as const;
export const questNavigationPurposeSchema = z.enum(QUEST_NAVIGATION_PURPOSES);
export type QuestNavigationPurpose = z.infer<typeof questNavigationPurposeSchema>;

export const questNavigateSchema = z
  .object({
    ...questCommandBase,
    questId: contentIdSchema,
    purpose: questNavigationPurposeSchema,
  })
  .strict();

export type QuestNavigate = z.infer<typeof questNavigateSchema>;

export const QUEST_NAVIGATION_STATUSES = [
  'moving',
  'waiting',
  'arrived',
  'stopped',
  'completed',
] as const;
export const questNavigationStatusSchema = z.enum(QUEST_NAVIGATION_STATUSES);
export type QuestNavigationStatus = z.infer<typeof questNavigationStatusSchema>;

export const QUEST_NAVIGATION_REASONS = [
  'manual',
  'player_dead',
  'target_gone',
  'out_of_range',
  'no_route',
  'quest_changed',
] as const;
export const questNavigationReasonSchema = z.enum(QUEST_NAVIGATION_REASONS);
export type QuestNavigationReason = z.infer<typeof questNavigationReasonSchema>;

/**
 * Server-authoritative navigation state for the current quest intent. `mapId`
 * is the next map hop when the destination is beyond a portal; the browser
 * only renders it.
 */
export const questNavigationSchema = z
  .object({
    questId: contentIdSchema,
    purpose: z.enum(['hunt', 'return', 'accept']),
    status: questNavigationStatusSchema,
    mapId: mapIdSchema.optional(),
    reason: questNavigationReasonSchema.optional(),
    serverTime: z.number().nonnegative(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.reason !== undefined && value.status !== 'stopped') {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'only a stopped guidance carries a reason',
      });
    }
  });

export type QuestNavigation = z.infer<typeof questNavigationSchema>;
