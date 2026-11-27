import { z } from 'zod';

import { characterClassSchema, type CharacterClass } from './character';
import { equipmentSlotSchema, itemKindSchema, itemQualitySchema } from './economy';

/**
 * Declarative content bundle shared by the admin editor, the Control API and
 * the game server. Only data lives here: effect kinds are a closed whitelist
 * executed by code (ADR-011 / ADR-022), never scripts or expressions.
 */

export const CONTENT_SCHEMA_VERSION = 1 as const;

export const CONTENT_SECTIONS = [
  'classes',
  'skills',
  'monsters',
  'items',
  'lootTables',
  'rules',
  'quests',
] as const;
export const contentSectionSchema = z.enum(CONTENT_SECTIONS);
export type ContentSection = z.infer<typeof contentSectionSchema>;

export const CONTENT_SECTION_LABELS: Record<ContentSection, string> = {
  classes: '职业',
  skills: '技能',
  monsters: '怪物',
  items: '物品',
  lootTables: '掉落表',
  rules: '全局规则',
  quests: '任务',
};

export const CONTENT_ID_PATTERN = /^[a-z][a-z0-9_]{0,47}$/u;
export const contentIdSchema = z
  .string()
  .regex(CONTENT_ID_PATTERN, '内容 ID 只能是小写字母开头的 snake_case（最多 48 字符）');

export const starterKitEntrySchema = z
  .object({
    templateId: contentIdSchema,
    quantity: z.number().int().min(1).max(100),
  })
  .strict();

export type StarterKitEntry = z.infer<typeof starterKitEntrySchema>;

export const classContentSchema = z
  .object({
    id: characterClassSchema,
    name: z.string().trim().min(1).max(16),
    description: z.string().trim().min(1).max(200),
    baseMaxHp: z.number().int().min(1).max(100_000),
    baseMaxMp: z.number().int().min(0).max(100_000),
    baseAttack: z.number().int().min(0).max(10_000),
    baseDefense: z.number().int().min(0).max(10_000),
    hpPerLevel: z.number().min(0).max(10_000),
    mpPerLevel: z.number().min(0).max(10_000),
    /**
     * Mana restored per second while alive. Optional for releases created
     * before Alpha 0.2; absent means no regeneration (EL-004).
     */
    mpRegenPerSecond: z.number().int().min(0).max(100).optional(),
    attackPerLevel: z.number().min(0).max(1_000),
    defensePerLevel: z.number().min(0).max(1_000),
    hitChance: z.number().min(0).max(1),
    critChance: z.number().min(0).max(1),
    critMultiplier: z.number().min(1).max(10),
    attackIntervalMs: z.number().int().min(100).max(60_000),
    attackRangeTiles: z.number().positive().max(20),
    starterKit: z.array(starterKitEntrySchema).min(1).max(8),
  })
  .strict();

export type ClassContent = z.infer<typeof classContentSchema>;

export const directDamageEffectSchema = z
  .object({
    kind: z.literal('directDamage'),
    multiplier: z.number().positive().max(10),
    flatDamage: z.number().int().min(0).max(10_000),
    canCrit: z.boolean(),
  })
  .strict();

export const healEffectSchema = z
  .object({
    kind: z.literal('heal'),
    baseHeal: z.number().int().min(1).max(10_000),
    healPerLevel: z.number().int().min(0).max(10_000),
  })
  .strict();

/**
 * Periodic damage on one enemy. Ticks are fixed by the server clock and always
 * land (no hit roll), so a DoT cannot consume RNG draws from the
 * deterministic combat replay (ADR-028).
 */
export const dotEffectSchema = z
  .object({
    kind: z.literal('dot'),
    multiplier: z.number().positive().max(10),
    flatDamage: z.number().int().min(0).max(10_000),
    tickIntervalMs: z.number().int().min(250).max(10_000),
    durationMs: z.number().int().min(1_000).max(60_000),
  })
  .strict();

/** Temporary damage absorption for the caster; a recast refreshes it. */
export const shieldEffectSchema = z
  .object({
    kind: z.literal('shield'),
    baseAmount: z.number().int().min(1).max(100_000),
    amountPerLevel: z.number().int().min(0).max(10_000),
    durationMs: z.number().int().min(1_000).max(60_000),
  })
  .strict();

/** Closed handler whitelist; a new kind needs a code release (ADR-011). */
export const skillEffectSchema = z.discriminatedUnion('kind', [
  directDamageEffectSchema,
  healEffectSchema,
  dotEffectSchema,
  shieldEffectSchema,
]);
export type SkillEffectContent = z.infer<typeof skillEffectSchema>;

export const skillTargetSchema = z.enum(['enemy', 'self']);
export type SkillTarget = z.infer<typeof skillTargetSchema>;

export const skillContentSchema = z
  .object({
    id: contentIdSchema,
    classId: characterClassSchema,
    name: z.string().trim().min(1).max(16),
    description: z.string().trim().min(1).max(200),
    levelRequirement: z.number().int().min(1).max(100),
    mpCost: z.number().int().min(0).max(10_000),
    cooldownMs: z.number().int().min(0).max(600_000),
    rangeTiles: z.number().positive().max(20),
    target: skillTargetSchema,
    hotkey: z.string().regex(/^[1-9]$/u, '技能快捷键必须是 1-9'),
    effect: skillEffectSchema,
  })
  .strict();

export type SkillContent = z.infer<typeof skillContentSchema>;

/**
 * One-shot second phase for a monster. When its HP first drops to the
 * threshold, the server applies the multipliers for the rest of that life;
 * every absent multiplier means "unchanged". The phase is content data, not a
 * script, so a new behaviour still needs a code release (ADR-037).
 */
export const monsterEnrageSchema = z
  .object({
    /** Trigger threshold in per-mille of max HP (500 = half health). */
    atHpPermille: z.number().int().min(1).max(999),
    attackMultiplier: z.number().min(1).max(5).optional(),
    /**
     * Multiplies the attack interval. Values below 1 attack sooner; 0.5 halves
     * the time between swings.
     */
    attackIntervalMultiplier: z.number().min(0.2).max(1).optional(),
    moveSpeedMultiplier: z.number().min(0.2).max(3).optional(),
    /** Absolute wind-up radius while enraged; requires `windupMs`. */
    windupRadiusTiles: z.number().positive().max(10).optional(),
  })
  .strict();

export type MonsterEnrage = z.infer<typeof monsterEnrageSchema>;

export const monsterContentSchema = z
  .object({
    id: contentIdSchema,
    name: z.string().trim().min(1).max(24),
    level: z.number().int().min(1).max(100),
    maxHp: z.number().int().min(1).max(10_000_000),
    attack: z.number().int().min(0).max(100_000),
    defense: z.number().int().min(0).max(100_000),
    hitChance: z.number().min(0).max(1),
    critChance: z.number().min(0).max(1),
    critMultiplier: z.number().min(1).max(10),
    attackIntervalMs: z.number().int().min(100).max(60_000),
    attackRangeTiles: z.number().positive().max(20),
    moveSpeedUnitsPerSecond: z.number().int().min(0).max(100_000),
    aggroTiles: z.number().positive().max(50),
    leashTiles: z.number().positive().max(50),
    patrolRadiusTiles: z.number().min(0).max(50),
    respawnMs: z.number().int().min(100).max(3_600_000),
    /**
     * Wind-up before the attack lands. Optional on purpose: historical
     * releases predate the field and a default would change their checksum
     * (EL-004). 0 or absent means the attack resolves immediately.
     */
    windupMs: z.number().int().min(0).max(5_000).optional(),
    /** Dodge window around the telegraphed impact point. */
    windupRadiusTiles: z.number().positive().max(6).optional(),
    /**
     * Marks a world boss: map-wide spawn/phase/death announcements, the boss
     * HUD and a distinct minimap marker. Optional so historical releases keep
     * their checksum (EL-004).
     */
    boss: z.boolean().optional(),
    enrage: monsterEnrageSchema.optional(),
  })
  .strict();

export type MonsterContent = z.infer<typeof monsterContentSchema>;

export const itemContentSchema = z
  .object({
    id: contentIdSchema,
    name: z.string().trim().min(1).max(24),
    kind: itemKindSchema,
    equipSlot: equipmentSlotSchema.optional(),
    /**
     * Optional rarity tag. Absent means `common`, so releases published before
     * quality existed keep their canonical checksum (EL-004).
     */
    quality: itemQualitySchema.optional(),
    classId: characterClassSchema.optional(),
    levelRequirement: z.number().int().min(1).max(100),
    stackable: z.boolean(),
    maxStack: z.number().int().min(1).max(1_000),
    attackBonus: z.number().int().min(0).max(100_000),
    defenseBonus: z.number().int().min(0).max(100_000),
    maxHpBonus: z.number().int().min(0).max(100_000),
    maxMpBonus: z.number().int().min(0).max(100_000),
    healHp: z.number().int().min(0).max(100_000),
    healMp: z.number().int().min(0).max(100_000),
    /**
     * Merchant prices. Optional on purpose: historical releases predate the
     * fields, and Zod defaults would change their canonical checksum (EL-004).
     */
    buyPrice: z.number().int().min(0).max(1_000_000).optional(),
    sellPrice: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

export type ItemContent = z.infer<typeof itemContentSchema>;

export const lootEntrySchema = z
  .object({
    templateId: contentIdSchema,
    chance: z.number().min(0).max(1),
    minQuantity: z.number().int().min(1).max(1_000),
    maxQuantity: z.number().int().min(1).max(1_000),
    /**
     * Contested loot has no owner, stays locked for a while and must be picked
     * up by hand; whoever reaches it after the lock wins it (ADR-041).
     */
    contested: z.boolean().optional(),
  })
  .strict();

export type LootEntryContent = z.infer<typeof lootEntrySchema>;

export const lootTableSchema = z
  .object({
    exp: z.number().int().min(0).max(1_000_000_000),
    goldMin: z.number().int().min(0).max(1_000_000_000),
    goldMax: z.number().int().min(0).max(1_000_000_000),
    entries: z.array(lootEntrySchema).max(20),
  })
  .strict();

export type LootTableContent = z.infer<typeof lootTableSchema>;

/**
 * Player death is the only experience sink. The rule lives in content so the
 * combined protection threshold and loss share can be tuned without a code
 * deploy; historical releases without the section keep death penalty-free.
 */
export const deathPenaltyRuleSchema = z
  .object({
    /**
     * Share of the experience progress inside the current level that is lost,
     * in per-mille. 0 disables the penalty; 1000 would erase all progress.
     */
    xpLossPermille: z.number().int().min(0).max(1_000),
    /** Characters below this level lose nothing when a monster kills them. */
    protectBelowLevel: z.number().int().min(1).max(100),
  })
  .strict();

export type DeathPenaltyRule = z.infer<typeof deathPenaltyRuleSchema>;

/**
 * Party size and kill-experience sharing (ADR-035). The share applies to every
 * other living member inside the radius; the killer always keeps the full
 * rolled reward (gold, drops and quest progress stay killer-only).
 */
export const partyRuleSchema = z
  .object({
    maxMembers: z.number().int().min(2).max(8),
    /** Share of the monster's base experience, in per-mille; 0 disables it. */
    assistSharePermille: z.number().int().min(0).max(1_000),
    assistRangeTiles: z.number().min(1).max(32),
  })
  .strict();

export type PartyRule = z.infer<typeof partyRuleSchema>;

/**
 * Daily quests reset on a per-realm wall clock (ADR-038). `hour` and
 * `utcOffsetMinutes` describe the realm-local reset time, so a player's day
 * boundary is the same for every client on the realm regardless of where the
 * browser runs.
 */
export const dailyResetRuleSchema = z
  .object({
    hour: z.number().int().min(0).max(23),
    utcOffsetMinutes: z.number().int().min(-720).max(840),
  })
  .strict();

export type DailyResetRule = z.infer<typeof dailyResetRuleSchema>;

/**
 * Loot tuning for owner auto-pickup and contested drops (ADR-041). Absent
 * fields fall back to code defaults, so historical releases keep their
 * checksums (EL-004).
 */
export const lootRuleSchema = z
  .object({
    /** Owner auto-pickup radius in tiles; defaults to 3. */
    autoPickupRangeTiles: z.number().min(1).max(10).optional(),
    /** How long contested drops stay unpickable; defaults to 60 seconds. */
    contestedDelayMs: z.number().int().min(0).max(600_000).optional(),
  })
  .strict();

export type LootRuleContent = z.infer<typeof lootRuleSchema>;

export const rulesContentSchema = z
  .object({
    deathPenalty: deathPenaltyRuleSchema.optional(),
    party: partyRuleSchema.optional(),
    dailyReset: dailyResetRuleSchema.optional(),
    loot: lootRuleSchema.optional(),
  })
  .strict();

export type RulesContent = z.infer<typeof rulesContentSchema>;

const npcIdSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z][a-z0-9_]*$/u, 'NPC id must be lowercase snake_case');

/**
 * Quest objectives are a closed whitelist like skill effects: only the server
 * knows how to observe progress, so a new kind needs a code release (ADR-034).
 */
export const questKillObjectiveSchema = z
  .object({
    kind: z.literal('kill'),
    monsterId: contentIdSchema,
    count: z.number().int().min(1).max(999),
  })
  .strict();

/**
 * Turn-in objective: the player must hand over `count` items from the bag when
 * claiming. Progress is derived from the bag at read time, so holding the items
 * before accepting is allowed and the claim consumes them exactly once
 * (ADR-040).
 */
export const questCollectObjectiveSchema = z
  .object({
    kind: z.literal('collect'),
    templateId: contentIdSchema,
    count: z.number().int().min(1).max(999),
  })
  .strict();

export const questObjectiveSchema = z.discriminatedUnion('kind', [
  questKillObjectiveSchema,
  questCollectObjectiveSchema,
]);
export type QuestObjective = z.infer<typeof questObjectiveSchema>;

export const questRewardItemSchema = z
  .object({
    templateId: contentIdSchema,
    quantity: z.number().int().min(1).max(100),
  })
  .strict();

export type QuestRewardItem = z.infer<typeof questRewardItemSchema>;

export const questRewardsSchema = z
  .object({
    exp: z.number().int().min(0).max(1_000_000_000),
    gold: z.number().int().min(0).max(1_000_000_000),
    items: z.array(questRewardItemSchema).max(6),
  })
  .strict();

export type QuestRewards = z.infer<typeof questRewardsSchema>;

/**
 * Repeat kinds are a closed whitelist like objectives (ADR-038). A daily quest
 * can be accepted again after each realm reset; every other quest is a
 * one-time chain step.
 */
export const QUEST_REPEAT_KINDS = ['daily'] as const;
export const questRepeatSchema = z.enum(QUEST_REPEAT_KINDS);
export type QuestRepeat = z.infer<typeof questRepeatSchema>;

export const questContentSchema = z
  .object({
    id: contentIdSchema,
    title: z.string().trim().min(1).max(24),
    description: z.string().trim().min(1).max(200),
    /** NPC that gives the quest and accepts the turn-in. */
    giverNpcId: npcIdSchema,
    levelRequirement: z.number().int().min(1).max(100),
    prerequisiteQuestId: contentIdSchema.optional(),
    /** Daily repeat; absent means a one-time quest. */
    repeat: questRepeatSchema.optional(),
    objective: questObjectiveSchema,
    rewards: questRewardsSchema,
  })
  .strict();

export type QuestContent = z.infer<typeof questContentSchema>;

const classesSectionSchema = z.record(characterClassSchema, classContentSchema);
const skillsSectionSchema = z.record(contentIdSchema, skillContentSchema);
const monstersSectionSchema = z.record(contentIdSchema, monsterContentSchema);
const itemsSectionSchema = z.record(contentIdSchema, itemContentSchema);
const lootTablesSectionSchema = z.record(contentIdSchema, lootTableSchema);
const questsSectionSchema = z.record(contentIdSchema, questContentSchema);

export const contentSectionDataSchemas = {
  classes: classesSectionSchema,
  skills: skillsSectionSchema,
  monsters: monstersSectionSchema,
  items: itemsSectionSchema,
  lootTables: lootTablesSectionSchema,
  rules: rulesContentSchema,
  quests: questsSectionSchema,
} as const;

export type ContentSectionData = {
  classes: Record<CharacterClass, ClassContent>;
  skills: Record<string, SkillContent>;
  monsters: Record<string, MonsterContent>;
  items: Record<string, ItemContent>;
  lootTables: Record<string, LootTableContent>;
  rules: RulesContent;
  quests: Record<string, QuestContent>;
};

export const contentBundleSchema = z
  .object({
    schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
    classes: classesSectionSchema,
    skills: skillsSectionSchema,
    monsters: monstersSectionSchema,
    items: itemsSectionSchema,
    lootTables: lootTablesSectionSchema,
    /** Optional for releases published before the section existed (EL-004). */
    rules: rulesContentSchema.optional(),
    /** Optional for the same reason: quests arrived after the first releases. */
    quests: questsSectionSchema.optional(),
  })
  .strict();

export type ContentBundle = z.infer<typeof contentBundleSchema>;

/**
 * Returns one section's data. `rules` is optional on releases published before
 * the section existed, so the result may be undefined (EL-004).
 */
export function contentSectionOf(
  bundle: ContentBundle,
  section: ContentSection,
): ContentSectionData[ContentSection] | undefined {
  return bundle[section];
}

export function withContentSection<K extends ContentSection>(
  bundle: ContentBundle,
  section: K,
  data: ContentSectionData[K],
): ContentBundle {
  return { ...bundle, [section]: data };
}
