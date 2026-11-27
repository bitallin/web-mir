import { describe, expect, it } from 'vitest';

import type { ContentBundle } from '@web-legend/contracts';
import { RUINED_FIELDS_MAP } from '@web-legend/contracts/maps';

import {
  BASE_CONTENT_BUNDLE,
  buildReleaseVersion,
  composeContentBundle,
  contentChecksum,
  diffContentBundles,
  summarizeChanges,
  validateContentBundle,
} from '../src/index';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withMutation(mutate: (bundle: ContentBundle) => void): ContentBundle {
  const bundle = clone(BASE_CONTENT_BUNDLE);
  mutate(bundle);
  return bundle;
}

describe('base content bundle', () => {
  it('passes schema and reference validation without errors', () => {
    const result = validateContentBundle(BASE_CONTENT_BUNDLE);
    expect(result.valid).toBe(true);
    expect(result.bundle).not.toBeNull();
    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('produces a checksum that ignores object key order', () => {
    const shuffled: unknown = {
      lootTables: BASE_CONTENT_BUNDLE.lootTables,
      items: BASE_CONTENT_BUNDLE.items,
      monsters: BASE_CONTENT_BUNDLE.monsters,
      skills: BASE_CONTENT_BUNDLE.skills,
      rules: BASE_CONTENT_BUNDLE.rules,
      quests: BASE_CONTENT_BUNDLE.quests,
      classes: {
        taoist: BASE_CONTENT_BUNDLE.classes.taoist,
        mage: BASE_CONTENT_BUNDLE.classes.mage,
        warrior: BASE_CONTENT_BUNDLE.classes.warrior,
      },
      schemaVersion: BASE_CONTENT_BUNDLE.schemaVersion,
    };
    const parsed = validateContentBundle(shuffled);
    expect(parsed.bundle).not.toBeNull();
    if (parsed.bundle === null) {
      return;
    }
    expect(contentChecksum(parsed.bundle)).toBe(contentChecksum(BASE_CONTENT_BUNDLE));
  });
});

describe('content validation', () => {
  it('rejects an unknown effect handler before it reaches code', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        const skill = bundle.skills['mage_fireball'];
        if (skill !== undefined) {
          skill.effect = { kind: 'script', source: 'while(true){}' } as never;
        }
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.bundle).toBeNull();
    expect(result.issues.some((issue) => issue.path.includes('effect'))).toBe(true);
  });

  it('rejects a loot entry that references a missing item', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        bundle.lootTables['wild_slime']?.entries.push({
          templateId: 'missing_item',
          chance: 1,
          minQuantity: 1,
          maxQuantity: 1,
        });
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('missing_item'))).toBe(true);
  });

  it('rejects a monster without a loot table', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        delete bundle.lootTables['forest_wolf'];
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path === 'monsters.forest_wolf')).toBe(true);
  });

  it('rejects a starter item that exceeds the stack limit', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        bundle.classes.warrior.starterKit = [
          { templateId: 'warrior_sword', quantity: 1 },
          { templateId: 'small_hp_potion', quantity: 99 },
        ];
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('堆叠上限'))).toBe(true);
  });

  it('rejects equipment using the wrong slot', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        bundle.items['cloth_armor'] = {
          ...bundle.items['cloth_armor']!,
          equipSlot: 'weapon',
        };
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path.endsWith('.equipSlot'))).toBe(true);
  });

  it('rejects a sell price that would let players mint gold', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        const potion = bundle.items['small_hp_potion'];
        if (potion !== undefined) {
          potion.buyPrice = 10;
          potion.sellPrice = 10;
        }
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('收购价'))).toBe(true);
  });

  it('rejects a quality tag on a non-equipment item', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        const potion = bundle.items['small_hp_potion'];
        if (potion !== undefined) {
          potion.quality = 'rare';
        }
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path.endsWith('.quality'))).toBe(true);
  });

  it('warns about equipment that no player could ever obtain', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        bundle.items['unreachable_blade'] = {
          ...bundle.items['warrior_sword']!,
          id: 'unreachable_blade',
          name: '失落之刃',
          levelRequirement: 9,
        };
      }),
    );
    expect(result.valid).toBe(true);
    expect(
      result.issues.some(
        (issue) =>
          issue.severity === 'warning' &&
          issue.path === 'items.unreachable_blade' &&
          issue.message.includes('无法获得'),
      ),
    ).toBe(true);
  });

  it('does not inject price defaults into legacy payloads (EL-004)', () => {
    const legacy = clone(BASE_CONTENT_BUNDLE);
    for (const item of Object.values(legacy.items)) {
      delete item.buyPrice;
      delete item.sellPrice;
    }
    const result = validateContentBundle(legacy);
    expect(result.valid).toBe(true);
    expect(result.bundle).not.toBeNull();
    if (result.bundle === null) {
      return;
    }
    expect(result.bundle.items['small_hp_potion']?.buyPrice).toBeUndefined();
    expect(contentChecksum(result.bundle)).toBe(contentChecksum(legacy));
  });

  it('rejects a healing skill aimed at an enemy', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        bundle.skills['taoist_heal'] = { ...bundle.skills['taoist_heal']!, target: 'enemy' };
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('自身'))).toBe(true);
  });

  it('rejects a shield skill aimed at an enemy', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        bundle.skills['warrior_iron_skin'] = {
          ...bundle.skills['warrior_iron_skin']!,
          target: 'enemy',
        };
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('护盾'))).toBe(true);
  });

  it('rejects a damage-over-time effect shorter than one tick', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        bundle.skills['taoist_poison'] = {
          ...bundle.skills['taoist_poison']!,
          effect: {
            kind: 'dot',
            multiplier: 0.6,
            flatDamage: 2,
            tickIntervalMs: 2_000,
            durationMs: 1_000,
          },
        };
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('跳伤间隔'))).toBe(true);
  });

  it('ships damage-over-time and shield skills in the baseline bundle', () => {
    const effects = new Set(
      Object.values(BASE_CONTENT_BUNDLE.skills).map((skill) => skill.effect.kind),
    );
    expect(effects).toEqual(new Set(['directDamage', 'heal', 'dot', 'shield']));
    expect(Object.keys(BASE_CONTENT_BUNDLE.skills)).toHaveLength(9);
  });

  it('ships a telegraphed elite and distinct monster behaviours', () => {
    const monsters = BASE_CONTENT_BUNDLE.monsters;
    expect(monsters['alpha_wolf']?.windupMs).toBeGreaterThan(0);
    expect(monsters['alpha_wolf']?.windupRadiusTiles).toBeGreaterThan(0);
    expect(monsters['venom_spider']?.attackRangeTiles).toBeGreaterThan(2);
    expect(monsters['stone_guard']?.moveSpeedUnitsPerSecond).toBeLessThan(
      monsters['wild_slime']?.moveSpeedUnitsPerSecond ?? 0,
    );
  });

  it('ships a world boss with an enrage phase and a ruins spawn', () => {
    const boss = BASE_CONTENT_BUNDLE.monsters['ashen_colossus'];
    expect(boss?.boss).toBe(true);
    expect(boss?.enrage).toEqual({
      atHpPermille: 500,
      attackMultiplier: 1.25,
      attackIntervalMultiplier: 0.75,
      windupRadiusTiles: 2.6,
      moveSpeedMultiplier: 1.2,
    });
    expect(BASE_CONTENT_BUNDLE.lootTables['ashen_colossus']?.exp).toBeGreaterThan(
      BASE_CONTENT_BUNDLE.lootTables['ruin_gargoyle']?.exp ?? 0,
    );
    const spawn = RUINED_FIELDS_MAP.monsterSpawns.find(
      (candidate) => candidate.monsterId === 'ashen_colossus',
    );
    expect(spawn?.id).toBe('ruins_colossus_1');
  });

  it('ships a content-driven death penalty with new-player protection', () => {
    expect(BASE_CONTENT_BUNDLE.rules?.deathPenalty).toEqual({
      xpLossPermille: 100,
      protectBelowLevel: 10,
    });
  });

  it('keeps releases without a rules section death-free (EL-004)', () => {
    const legacy = clone(BASE_CONTENT_BUNDLE);
    delete legacy.rules;
    const result = validateContentBundle(legacy);
    expect(result.valid).toBe(true);
    expect(result.bundle?.rules).toBeUndefined();
    if (result.bundle === null) {
      return;
    }
    expect(contentChecksum(result.bundle)).toBe(contentChecksum(legacy));
  });

  it('rejects out-of-range death penalty values', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        bundle.rules = { deathPenalty: { xpLossPermille: 1_001, protectBelowLevel: 0 } };
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path.startsWith('rules.deathPenalty'))).toBe(true);
  });

  it('warns when a death penalty would be harsh or disabled', () => {
    const harsh = validateContentBundle(
      withMutation((bundle) => {
        bundle.rules = { deathPenalty: { xpLossPermille: 400, protectBelowLevel: 1 } };
      }),
    );
    expect(harsh.valid).toBe(true);
    expect(
      harsh.issues
        .filter((issue) => issue.path.startsWith('rules.deathPenalty'))
        .map((issue) => issue.path)
        .sort(),
    ).toEqual(['rules.deathPenalty.protectBelowLevel', 'rules.deathPenalty.xpLossPermille']);

    const disabled = validateContentBundle(
      withMutation((bundle) => {
        bundle.rules = { deathPenalty: { xpLossPermille: 0, protectBelowLevel: 10 } };
      }),
    );
    expect(disabled.valid).toBe(true);
    expect(disabled.issues.some((issue) => issue.message.includes('死亡不产生成长代价'))).toBe(
      true,
    );
  });

  it('rejects an enraged dodge radius without a wind-up', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        const boss = bundle.monsters['ashen_colossus'];
        if (boss !== undefined) {
          boss.windupMs = 0;
        }
      }),
    );
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) => issue.path === 'monsters.ashen_colossus.enrage.windupRadiusTiles',
      ),
    ).toBe(true);
  });

  it('rejects a dodge radius without a wind-up', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        const monster = bundle.monsters['alpha_wolf'];
        if (monster !== undefined) {
          monster.windupMs = 0;
        }
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('攻击前摇'))).toBe(true);
  });
});

describe('content diff', () => {
  it('diffs optional fields that are absent on one side', () => {
    const legacy = clone(BASE_CONTENT_BUNDLE);
    const potion = legacy.items['small_hp_potion'];
    const mage = legacy.classes.mage;
    if (potion === undefined || mage === undefined) {
      throw new Error('baseline content is missing a fixture');
    }
    delete potion.buyPrice;
    delete mage.mpRegenPerSecond;

    const changes = diffContentBundles(legacy, BASE_CONTENT_BUNDLE);
    expect(
      changes.find((change) => change.section === 'items' && change.id === 'small_hp_potion')
        ?.fields,
    ).toContain('buyPrice');
    expect(
      changes.find((change) => change.section === 'classes' && change.id === 'mage')?.fields,
    ).toContain('mpRegenPerSecond');
  });

  it('reports added, removed and changed entities with fields', () => {
    const candidate = withMutation((bundle) => {
      const table = bundle.lootTables['wild_slime'];
      if (table !== undefined) {
        table.exp = 30;
      }
      delete bundle.monsters['forest_wolf'];
      bundle.items['iron_helm'] = {
        ...bundle.items['cloth_armor']!,
        id: 'iron_helm',
        name: '铁盔',
        levelRequirement: 2,
      };
    });
    const changes = diffContentBundles(BASE_CONTENT_BUNDLE, candidate);
    expect(changes).toContainEqual({
      section: 'lootTables',
      id: 'wild_slime',
      kind: 'changed',
      fields: ['exp'],
    });
    expect(changes).toContainEqual({
      section: 'monsters',
      id: 'forest_wolf',
      kind: 'removed',
      fields: [],
    });
    expect(changes).toContainEqual({
      section: 'items',
      id: 'iron_helm',
      kind: 'added',
      fields: [],
    });
    expect(summarizeChanges(changes)).toEqual({ added: 1, removed: 1, changed: 1 });
  });
});

describe('draft composition', () => {
  it('overlays a draft section on the active bundle', () => {
    const draftLoot = clone(BASE_CONTENT_BUNDLE.lootTables);
    draftLoot['wild_slime'] = { ...draftLoot['wild_slime']!, exp: 40 };
    const composed = composeContentBundle(BASE_CONTENT_BUNDLE, { lootTables: draftLoot });
    const result = validateContentBundle(composed);
    expect(result.valid).toBe(true);
    expect(result.bundle?.lootTables['wild_slime']?.exp).toBe(40);
  });

  it('rejects a draft section with the wrong key type', () => {
    const composed = composeContentBundle(BASE_CONTENT_BUNDLE, {
      items: { not_an_item: { bad: true } },
    });
    const result = validateContentBundle(composed);
    expect(result.valid).toBe(false);
    expect(result.bundle).toBeNull();
  });
});

describe('quest validation', () => {
  it('rejects a quest whose giver is not on any map', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        const quest = bundle.quests?.['quest_slime_cleanup'];
        if (quest !== undefined) {
          quest.giverNpcId = 'missing_npc';
        }
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path.endsWith('.giverNpcId'))).toBe(true);
  });

  it('rejects a reward item that does not exist', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        const quest = bundle.quests?.['quest_slime_cleanup'];
        if (quest !== undefined) {
          quest.rewards.items = [{ templateId: 'missing_item', quantity: 1 }];
        }
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('missing_item'))).toBe(true);
  });

  it('rejects a prerequisite loop', () => {
    const result = validateContentBundle(
      withMutation((bundle) => {
        const first = bundle.quests?.['quest_slime_cleanup'];
        const second = bundle.quests?.['quest_wolf_patrol'];
        if (first !== undefined && second !== undefined) {
          first.prerequisiteQuestId = 'quest_wolf_patrol';
          first.levelRequirement = 10;
        }
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('循环'))).toBe(true);
  });

  it('keeps the pre-quest releases valid without the section', () => {
    const withoutQuests = withMutation((bundle) => {
      delete bundle.quests;
    });
    const result = validateContentBundle(withoutQuests);
    expect(result.valid).toBe(true);
  });
});

describe('release versions', () => {
  it('uses UTC date and a daily sequence', () => {
    expect(buildReleaseVersion(new Date('2026-11-25T23:59:00Z'), 3)).toBe('2026.11.25.3');
  });

  it('rejects an invalid sequence', () => {
    expect(() => buildReleaseVersion(new Date(), 0)).toThrow(RangeError);
  });
});
