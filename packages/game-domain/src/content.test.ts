import { CHARACTER_CLASSES } from '@web-legend/contracts';
import { describe, expect, it } from 'vitest';

import {
  MONSTER_CATALOG,
  SKILL_CATALOG,
  requireMonster,
  requireSkill,
  skillsForClass,
} from './content';

describe('phase-4 content catalog', () => {
  it('gives every class three skills unlocked at levels 1, 5 and 10', () => {
    for (const classId of CHARACTER_CLASSES) {
      const skills = skillsForClass(classId);
      expect(skills).toHaveLength(3);
      expect(skills.map((skill) => skill.levelRequirement)).toEqual([1, 5, 10]);
      expect(skills.map((skill) => skill.hotkey)).toEqual(['1', '2', '3']);
      for (const skill of skills) {
        expect(skill.classId).toBe(classId);
      }
    }
  });

  it('returns unlock order even when content keys are shuffled by jsonb', () => {
    const shuffled = {
      warrior_iron_skin: requireSkill('warrior_iron_skin'),
      warrior_heavy_strike: requireSkill('warrior_heavy_strike'),
      warrior_cleave: requireSkill('warrior_cleave'),
    };
    expect(skillsForClass('warrior', shuffled).map((skill) => skill.id)).toEqual([
      'warrior_heavy_strike',
      'warrior_iron_skin',
      'warrior_cleave',
    ]);
  });

  it('covers direct damage, heal, damage-over-time and shield handlers', () => {
    const effects = new Set(Object.values(SKILL_CATALOG).map((skill) => skill.effect.kind));
    expect(effects).toEqual(new Set(['directDamage', 'heal', 'dot', 'shield']));
  });

  it('defines two monsters with aggro, leash and respawn rules', () => {
    const monsters = Object.values(MONSTER_CATALOG);
    expect(monsters.map((monster) => monster.id).sort()).toEqual(['forest_wolf', 'wild_slime']);
    for (const monster of monsters) {
      expect(monster.leashTiles).toBeGreaterThanOrEqual(monster.aggroTiles);
      expect(monster.respawnMs).toBeGreaterThan(0);
      expect(monster.attackRangeTiles).toBeGreaterThan(0);
    }
  });

  it('throws for unknown ids instead of returning a default', () => {
    expect(() => requireSkill('missing_skill')).toThrow(RangeError);
    expect(() => requireMonster('missing_monster')).toThrow(RangeError);
  });
});
