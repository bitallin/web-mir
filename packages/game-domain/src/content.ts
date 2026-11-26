import { BASE_CONTENT_BUNDLE } from '@web-legend/content-schema/base';
import {
  COMBAT_CONTENT_VERSION,
  type CharacterClass,
  type ContentBundle,
  type MonsterContent,
  type SkillContent,
  type SkillEffectContent,
  type SkillTarget,
} from '@web-legend/contracts';

/**
 * Behaviour rules consume declarative content bundles (ADR-022). The baseline
 * bundle is validated when `content-schema` loads, so these defaults are safe;
 * a Room passes its own fixed snapshot to keep a battle reproducible.
 */

export type SkillDefinition = SkillContent;
export type MonsterDefinition = MonsterContent;
export type SkillEffect = SkillEffectContent;
export type DamageEffect = Extract<SkillEffectContent, { kind: 'directDamage' }>;
export type HealEffect = Extract<SkillEffectContent, { kind: 'heal' }>;
export type DotEffect = Extract<SkillEffectContent, { kind: 'dot' }>;
export type ShieldEffect = Extract<SkillEffectContent, { kind: 'shield' }>;
export type { SkillTarget };

export type SkillCatalog = Readonly<Record<string, SkillContent>>;
export type MonsterCatalog = Readonly<Record<string, MonsterContent>>;

export const SKILL_CATALOG: SkillCatalog = BASE_CONTENT_BUNDLE.skills;
export const MONSTER_CATALOG: MonsterCatalog = BASE_CONTENT_BUNDLE.monsters;

export const DEFAULT_CONTENT_BUNDLE: ContentBundle = BASE_CONTENT_BUNDLE;

/**
 * Skills are returned in unlock order. The order cannot come from the content
 * object: PostgreSQL stores the release payload as jsonb, which reorders keys,
 * so the bar would otherwise shuffle between releases (hotkey 2 before 1).
 */
export function skillsForClass(
  classId: CharacterClass,
  skills: SkillCatalog = SKILL_CATALOG,
): SkillDefinition[] {
  return Object.values(skills)
    .filter((skill) => skill.classId === classId)
    .sort(
      (left, right) =>
        left.levelRequirement - right.levelRequirement || left.hotkey.localeCompare(right.hotkey),
    );
}

export function requireSkill(
  skillId: string,
  skills: SkillCatalog = SKILL_CATALOG,
): SkillDefinition {
  const skill = skills[skillId];
  if (skill === undefined) {
    throw new RangeError(`unknown skill "${skillId}"`);
  }
  return skill;
}

export function requireMonster(
  monsterId: string,
  monsters: MonsterCatalog = MONSTER_CATALOG,
): MonsterDefinition {
  const monster = monsters[monsterId];
  if (monster === undefined) {
    throw new RangeError(`unknown monster "${monsterId}"`);
  }
  return monster;
}

export { COMBAT_CONTENT_VERSION };
