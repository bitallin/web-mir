export { BASIC_ATTACK_MODIFIER, combatStatsAsOffense, distanceInTiles, rollAttack } from './combat';
export type { AttackModifier, AttackRoll, DefenseStats, OffenseStats, Rng } from './combat';

export {
  COMBAT_CONTENT_VERSION,
  DEFAULT_CONTENT_BUNDLE,
  MONSTER_CATALOG,
  SKILL_CATALOG,
  requireMonster,
  requireSkill,
  skillsForClass,
} from './content';
export type {
  DamageEffect,
  HealEffect,
  MonsterDefinition,
  SkillDefinition,
  SkillEffect,
  SkillTarget,
} from './content';

export { CombatWorld } from './combatWorld';
export type {
  CombatCommandResult,
  CombatGrid,
  CombatMonsterSnapshot,
  CombatPlayerInput,
  CombatPlayerSnapshot,
  CombatProfileData,
  CombatRejection,
  CombatWorldOptions,
  Pathfinder,
  UnitPoint,
} from './combatWorld';

export { combatStatsFor, MAX_COMBAT_LEVEL } from './stats';
export type { CombatStats } from './stats';

export {
  ITEM_CATALOG,
  STARTER_GOLD,
  STARTER_KIT,
  canEquip,
  equipmentBonuses,
  findInventoryPlacement,
  isConsumable,
  isShopQuantityAllowed,
  itemBuyPrice,
  itemSellPrice,
  purchaseCost,
  requireItem,
  saleValue,
  starterKitFor,
  statsWithEquipment,
} from './items';
export type {
  EquippedItem,
  EquipmentBonuses,
  InventoryPlacement,
  InventoryStack,
  ItemCatalog,
  ItemDefinition,
  StarterItem,
} from './items';

export { MONSTER_LOOT_TABLES, requireLootTable, rollLoot } from './loot';
export type { LootEntry, LootRoll, LootTable, RolledLootItem } from './loot';

export { MAX_CHARACTER_LEVEL, applyExperience, experienceForNextLevel } from './progression';
export type { ExperienceResult } from './progression';

export { createChatFilter, defaultChatFilter } from './social';
export type { ChatFilter, ChatFilterOptions, ChatFilterResult } from './social';
