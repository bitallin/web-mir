import { COMBAT_CONTENT_VERSION, type CharacterClass } from '@web-legend/contracts';

/**
 * Fixed phase-4 content catalog. IDs and the version string are stable; phase 7
 * moves these numbers into versioned Content Releases, but the effect handlers
 * stay in code (ADR-011).
 */

export type SkillTarget = 'enemy' | 'self';

export type DamageEffect = {
  kind: 'directDamage';
  multiplier: number;
  flatDamage: number;
  canCrit: boolean;
};

export type HealEffect = {
  kind: 'heal';
  baseHeal: number;
  healPerLevel: number;
};

export type SkillEffect = DamageEffect | HealEffect;

export type SkillDefinition = {
  id: string;
  classId: CharacterClass;
  name: string;
  description: string;
  levelRequirement: number;
  mpCost: number;
  cooldownMs: number;
  rangeTiles: number;
  target: SkillTarget;
  hotkey: string;
  effect: SkillEffect;
};

export type MonsterDefinition = {
  id: string;
  name: string;
  level: number;
  maxHp: number;
  attack: number;
  defense: number;
  hitChance: number;
  critChance: number;
  critMultiplier: number;
  attackIntervalMs: number;
  attackRangeTiles: number;
  moveSpeedUnitsPerSecond: number;
  aggroTiles: number;
  leashTiles: number;
  patrolRadiusTiles: number;
  respawnMs: number;
};

export const SKILL_CATALOG: Readonly<Record<string, SkillDefinition>> = {
  warrior_heavy_strike: {
    id: 'warrior_heavy_strike',
    classId: 'warrior',
    name: '重击',
    description: '蓄力劈砍，对近身目标造成 160% 伤害并附加 4 点伤害。',
    levelRequirement: 1,
    mpCost: 6,
    cooldownMs: 5_000,
    rangeTiles: 1.6,
    target: 'enemy',
    hotkey: '1',
    effect: { kind: 'directDamage', multiplier: 1.6, flatDamage: 4, canCrit: true },
  },
  mage_fireball: {
    id: 'mage_fireball',
    classId: 'mage',
    name: '火球术',
    description: '凝聚火球轰击远处目标，造成 140% 伤害并附加 6 点伤害。',
    levelRequirement: 1,
    mpCost: 10,
    cooldownMs: 3_000,
    rangeTiles: 6,
    target: 'enemy',
    hotkey: '1',
    effect: { kind: 'directDamage', multiplier: 1.4, flatDamage: 6, canCrit: true },
  },
  taoist_heal: {
    id: 'taoist_heal',
    classId: 'taoist',
    name: '治愈术',
    description: '引动真气恢复自身 30 点生命，每级额外恢复 4 点。',
    levelRequirement: 1,
    mpCost: 12,
    cooldownMs: 8_000,
    rangeTiles: 1,
    target: 'self',
    hotkey: '1',
    effect: { kind: 'heal', baseHeal: 30, healPerLevel: 4 },
  },
};

export const MONSTER_CATALOG: Readonly<Record<string, MonsterDefinition>> = {
  wild_slime: {
    id: 'wild_slime',
    name: '野地史莱姆',
    level: 2,
    maxHp: 50,
    attack: 6,
    defense: 2,
    hitChance: 0.85,
    critChance: 0.03,
    critMultiplier: 1.5,
    attackIntervalMs: 1_600,
    attackRangeTiles: 1.1,
    moveSpeedUnitsPerSecond: 2_200,
    aggroTiles: 4,
    leashTiles: 6,
    patrolRadiusTiles: 2,
    respawnMs: 8_000,
  },
  forest_wolf: {
    id: 'forest_wolf',
    name: '森林狼',
    level: 3,
    maxHp: 80,
    attack: 9,
    defense: 3,
    hitChance: 0.9,
    critChance: 0.08,
    critMultiplier: 1.6,
    attackIntervalMs: 1_200,
    attackRangeTiles: 1.15,
    moveSpeedUnitsPerSecond: 3_600,
    aggroTiles: 6,
    leashTiles: 8,
    patrolRadiusTiles: 3,
    respawnMs: 10_000,
  },
};

export function skillsForClass(classId: CharacterClass): SkillDefinition[] {
  return Object.values(SKILL_CATALOG).filter((skill) => skill.classId === classId);
}

export function requireSkill(skillId: string): SkillDefinition {
  const skill = SKILL_CATALOG[skillId];
  if (skill === undefined) {
    throw new RangeError(`unknown skill "${skillId}"`);
  }
  return skill;
}

export function requireMonster(monsterId: string): MonsterDefinition {
  const monster = MONSTER_CATALOG[monsterId];
  if (monster === undefined) {
    throw new RangeError(`unknown monster "${monsterId}"`);
  }
  return monster;
}

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;

function assertSkill(skill: SkillDefinition): void {
  if (!ID_PATTERN.test(skill.id)) {
    throw new Error(`skill id "${skill.id}" is not lowercase snake_case`);
  }
  if (skill.mpCost < 0 || skill.cooldownMs < 0 || skill.rangeTiles <= 0) {
    throw new Error(`skill "${skill.id}" has invalid cost, cooldown or range`);
  }
  if (skill.effect.kind === 'directDamage') {
    if (skill.effect.multiplier <= 0 || skill.effect.flatDamage < 0) {
      throw new Error(`skill "${skill.id}" has an invalid damage effect`);
    }
  } else if (skill.effect.baseHeal <= 0 || skill.effect.healPerLevel < 0) {
    throw new Error(`skill "${skill.id}" has an invalid heal effect`);
  }
}

function assertMonster(monster: MonsterDefinition): void {
  if (!ID_PATTERN.test(monster.id)) {
    throw new Error(`monster id "${monster.id}" is not lowercase snake_case`);
  }
  if (
    monster.maxHp <= 0 ||
    monster.attack < 0 ||
    monster.defense < 0 ||
    monster.attackIntervalMs <= 0 ||
    monster.moveSpeedUnitsPerSecond <= 0 ||
    monster.aggroTiles <= 0 ||
    monster.leashTiles < monster.aggroTiles ||
    monster.respawnMs <= 0
  ) {
    throw new Error(`monster "${monster.id}" has an invalid definition`);
  }
}

function assertCatalog(): void {
  for (const skill of Object.values(SKILL_CATALOG)) {
    assertSkill(skill);
  }
  for (const classId of ['warrior', 'mage', 'taoist'] as const) {
    if (skillsForClass(classId).length === 0) {
      throw new Error(`class "${classId}" has no skill`);
    }
  }
  for (const monster of Object.values(MONSTER_CATALOG)) {
    assertMonster(monster);
  }
}

assertCatalog();

export { COMBAT_CONTENT_VERSION };
