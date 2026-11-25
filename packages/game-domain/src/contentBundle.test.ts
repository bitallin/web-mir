import type { ContentBundle } from '@web-legend/contracts';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONTENT_BUNDLE,
  requireItem,
  requireLootTable,
  requireMonster,
  requireSkill,
} from './index';
import { combatStatsFor } from './stats';
import { DEFAULT_SLIME_SPAWN, createTestWorld } from './testSupport';

function cloneBundle(): ContentBundle {
  return JSON.parse(JSON.stringify(DEFAULT_CONTENT_BUNDLE)) as ContentBundle;
}

describe('room content bundles', () => {
  it('derives class stats from the bundle instead of hard-coded growth', () => {
    const bundle = cloneBundle();
    bundle.classes.warrior.baseMaxHp = 240;
    const stats = combatStatsFor('warrior', 1, bundle);
    expect(stats.maxHp).toBe(240);
    expect(combatStatsFor('warrior', 1).maxHp).toBe(120);
  });

  it('spawns monsters with the bundle definition', () => {
    const bundle = cloneBundle();
    const slime = bundle.monsters['wild_slime'];
    expect(slime).toBeDefined();
    if (slime === undefined) {
      return;
    }
    slime.maxHp = 123;
    slime.name = '训练木桩';
    const world = createTestWorld({ content: bundle });
    const monster = world.getMonster(DEFAULT_SLIME_SPAWN.id);
    expect(monster?.maxHp).toBe(123);
    expect(monster?.displayName).toBe('训练木桩');
    expect(requireMonster('wild_slime', bundle.monsters).maxHp).toBe(123);
  });

  it('resolves skills, items and loot from the same bundle', () => {
    const bundle = cloneBundle();
    const skill = bundle.skills.warrior_heavy_strike;
    if (skill?.effect.kind === 'directDamage') {
      skill.effect.multiplier = 2.5;
    }
    const sword = bundle.items['warrior_sword'];
    const slimeLoot = bundle.lootTables['wild_slime'];
    expect(sword).toBeDefined();
    expect(slimeLoot).toBeDefined();
    if (sword === undefined || slimeLoot === undefined) {
      return;
    }
    sword.attackBonus = 15;
    slimeLoot.exp = 44;

    expect(requireSkill('warrior_heavy_strike', bundle.skills).effect).toEqual({
      kind: 'directDamage',
      multiplier: 2.5,
      flatDamage: 4,
      canCrit: true,
    });
    expect(requireItem('warrior_sword', bundle.items).attackBonus).toBe(15);
    expect(requireLootTable('wild_slime', bundle.lootTables).exp).toBe(44);
  });

  it('keeps the baseline when no bundle is injected', () => {
    expect(combatStatsFor('mage', 1).maxMp).toBe(80);
    expect(requireItem('mage_staff').attackBonus).toBe(7);
    expect(requireLootTable('forest_wolf').exp).toBe(22);
  });
});
