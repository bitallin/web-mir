import { z } from 'zod';

import { characterClassSchema, type CharacterClass } from './character';
import { equipmentSlotSchema, itemKindSchema } from './economy';

/**
 * Declarative content bundle shared by the admin editor, the Control API and
 * the game server. Only data lives here: effect kinds are a closed whitelist
 * executed by code (ADR-011 / ADR-022), never scripts or expressions.
 */

export const CONTENT_SCHEMA_VERSION = 1 as const;

export const CONTENT_SECTIONS = ['classes', 'skills', 'monsters', 'items', 'lootTables'] as const;
export const contentSectionSchema = z.enum(CONTENT_SECTIONS);
export type ContentSection = z.infer<typeof contentSectionSchema>;

export const CONTENT_SECTION_LABELS: Record<ContentSection, string> = {
  classes: '职业',
  skills: '技能',
  monsters: '怪物',
  items: '物品',
  lootTables: '掉落表',
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
  })
  .strict();

export type MonsterContent = z.infer<typeof monsterContentSchema>;

export const itemContentSchema = z
  .object({
    id: contentIdSchema,
    name: z.string().trim().min(1).max(24),
    kind: itemKindSchema,
    equipSlot: equipmentSlotSchema.optional(),
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

const classesSectionSchema = z.record(characterClassSchema, classContentSchema);
const skillsSectionSchema = z.record(contentIdSchema, skillContentSchema);
const monstersSectionSchema = z.record(contentIdSchema, monsterContentSchema);
const itemsSectionSchema = z.record(contentIdSchema, itemContentSchema);
const lootTablesSectionSchema = z.record(contentIdSchema, lootTableSchema);

export const contentSectionDataSchemas = {
  classes: classesSectionSchema,
  skills: skillsSectionSchema,
  monsters: monstersSectionSchema,
  items: itemsSectionSchema,
  lootTables: lootTablesSectionSchema,
} as const;

export type ContentSectionData = {
  classes: Record<CharacterClass, ClassContent>;
  skills: Record<string, SkillContent>;
  monsters: Record<string, MonsterContent>;
  items: Record<string, ItemContent>;
  lootTables: Record<string, LootTableContent>;
};

export const contentBundleSchema = z
  .object({
    schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
    classes: classesSectionSchema,
    skills: skillsSectionSchema,
    monsters: monstersSectionSchema,
    items: itemsSectionSchema,
    lootTables: lootTablesSectionSchema,
  })
  .strict();

export type ContentBundle = z.infer<typeof contentBundleSchema>;

export function contentSectionOf<K extends ContentSection>(
  bundle: ContentBundle,
  section: K,
): ContentSectionData[K] {
  return bundle[section];
}

export function withContentSection<K extends ContentSection>(
  bundle: ContentBundle,
  section: K,
  data: ContentSectionData[K],
): ContentBundle {
  return { ...bundle, [section]: data };
}
