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
  it('gives every class exactly one usable skill', () => {
    for (const classId of CHARACTER_CLASSES) {
      const skills = skillsForClass(classId);
      expect(skills).toHaveLength(1);
      expect(skills[0]?.classId).toBe(classId);
      expect(skills[0]?.levelRequirement).toBe(1);
      expect(skills[0]?.hotkey).toBe('1');
    }
  });

  it('covers both direct damage and heal effect handlers', () => {
    const effects = new Set(Object.values(SKILL_CATALOG).map((skill) => skill.effect.kind));
    expect(effects).toEqual(new Set(['directDamage', 'heal']));
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
