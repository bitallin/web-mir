import type { QuestContent } from '@web-legend/contracts';
import { MAP_MANIFESTS } from '@web-legend/contracts/maps';
import { BASE_CONTENT_BUNDLE } from '@web-legend/content-schema/base';
import { describe, expect, it } from 'vitest';

import { applyExperience } from './progression';

/**
 * The main chain is content, so its integrity is checked here rather than by a
 * runtime guard: one linear chain, reachable levels, and enough experience from
 * the required kills alone to finish it. Side quests are one-time quests that
 * stand outside the chain and are pinned explicitly so new content stays
 * intentional.
 */
const SIDE_QUESTS = ['quest_supply_delivery'] as const;

const EXPECTED_CHAIN = [
  'quest_slime_cleanup',
  'quest_wolf_patrol',
  'quest_spider_nest',
  'quest_stone_guard',
  'quest_alpha_wolf',
  'quest_ruins_bones',
  'quest_ruins_corruption',
  'quest_ruins_gargoyle',
  'quest_ruins_purge',
  'quest_ruins_colossus',
] as const;

function oneTimeQuests(): readonly QuestContent[] {
  return Object.values(BASE_CONTENT_BUNDLE.quests ?? {}).filter(
    (quest) => quest.repeat === undefined,
  );
}

function chainQuests(): QuestContent[] {
  const quests = BASE_CONTENT_BUNDLE.quests ?? {};
  return EXPECTED_CHAIN.map((id) => {
    const quest = quests[id];
    if (quest === undefined) {
      throw new Error(`missing chain quest "${id}"`);
    }
    return quest;
  });
}

describe('the main quest chain', () => {
  it('is one linear ten-step chain with a frontier giver for the ruins', () => {
    const chain = chainQuests();
    expect(chain.map((quest) => quest.id)).toEqual([...EXPECTED_CHAIN]);
    expect(chain[0]?.prerequisiteQuestId).toBeUndefined();
    for (let index = 1; index < chain.length; index += 1) {
      expect(chain[index]?.prerequisiteQuestId).toBe(chain[index - 1]?.id);
    }
    // Every one-time quest is either a chain step or a declared side quest, and
    // a side quest never gates the chain.
    expect(
      oneTimeQuests()
        .map((quest) => quest.id)
        .sort(),
    ).toEqual([...EXPECTED_CHAIN, ...SIDE_QUESTS].sort());
    for (const sideId of SIDE_QUESTS) {
      expect(chain.some((quest) => quest.prerequisiteQuestId === sideId)).toBe(false);
    }

    const givers = chain.map((quest) => quest.giverNpcId);
    expect(givers.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => 'town_guard'));
    expect(givers.slice(5)).toEqual(Array.from({ length: 5 }, () => 'ruins_scout'));

    const ruins = MAP_MANIFESTS.find((map) => map.mapId === 'ruined_fields');
    expect(ruins?.npcPoints.find((npc) => npc.id === 'ruins_scout')?.role).toBe('scout');

    for (let index = 1; index < chain.length; index += 1) {
      expect(chain[index]?.levelRequirement).toBeGreaterThanOrEqual(
        chain[index - 1]?.levelRequirement ?? 0,
      );
    }
  });

  it('can be finished from level 1 using only its own kills and rewards', () => {
    let level = 1;
    let exp = 0;
    for (const quest of chainQuests()) {
      expect(level).toBeGreaterThanOrEqual(quest.levelRequirement);
      if (quest.objective.kind !== 'kill') {
        throw new Error(`chain step "${quest.id}" must have a kill objective`);
      }
      const killExp =
        (BASE_CONTENT_BUNDLE.lootTables[quest.objective.monsterId]?.exp ?? 0) *
        quest.objective.count;
      const gained = killExp + quest.rewards.exp;
      const result = applyExperience(level, exp, gained);
      level = result.level;
      exp = result.exp;
    }
    const last = chainQuests().at(-1);
    expect(level).toBeGreaterThanOrEqual(last?.levelRequirement ?? 0);
  });
});
