export { BASIC_ATTACK_MODIFIER, combatStatsAsOffense, distanceInTiles, rollAttack } from './combat';
export type { AttackModifier, AttackRoll, DefenseStats, OffenseStats, Rng } from './combat';

export {
  COMBAT_CONTENT_VERSION,
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
