import type { QuestStatus, QuestView } from '@web-legend/contracts';
import { describe, expect, it } from 'vitest';

import {
  groupQuestsByStatus,
  nextAvailableQuest,
  questObjectiveLabel,
  questObjectiveProgressLabel,
} from './questPanel';

function quest(questId: string, status: QuestStatus, repeat?: 'daily'): QuestView {
  return {
    questId,
    title: questId,
    description: questId,
    giverNpcId: 'town_guard',
    giverNpcName: '守卫',
    levelRequirement: 1,
    ...(repeat === undefined ? {} : { repeat }),
    status,
    progress: 0,
    objective: {
      kind: 'kill',
      monsterId: 'wild_slime',
      monsterName: '野地史莱姆',
      count: 1,
    },
    rewards: { exp: 1, gold: 1, items: [] },
  };
}

describe('questObjectiveLabel', () => {
  it('names the monster, the collected item or the arrival place', () => {
    expect(
      questObjectiveLabel({
        kind: 'kill',
        monsterId: 'wild_slime',
        monsterName: '野地史莱姆',
        count: 3,
      }),
    ).toBe('野地史莱姆');
    expect(
      questObjectiveLabel({
        kind: 'collect',
        templateId: 'small_hp_potion',
        itemName: '金创药',
        count: 1,
      }),
    ).toBe('收集 金创药');
    expect(
      questObjectiveLabel({
        kind: 'reach',
        mapId: 'starter_wilds',
        mapName: '静语荒野',
        tile: { x: 40, y: 10 },
        radiusTiles: 2,
      }),
    ).toBe('到达 静语荒野（40,10）');
  });
});

describe('questObjectiveProgressLabel', () => {
  it('shows a ratio for counted objectives and arrival state for reach', () => {
    expect(
      questObjectiveProgressLabel(
        { kind: 'kill', monsterId: 'wild_slime', monsterName: '野地史莱姆', count: 3 },
        2,
      ),
    ).toBe('2/3');
    const reach = {
      kind: 'reach',
      mapId: 'starter_town',
      mapName: '晨曦主城',
      tile: { x: 35, y: 15 },
      radiusTiles: 2,
    } as const;
    expect(questObjectiveProgressLabel(reach, 0)).toBe('未到达');
    expect(questObjectiveProgressLabel(reach, 1)).toBe('已到达');
  });
});

describe('groupQuestsByStatus', () => {
  it('puts turn-ins and active quests ahead of locked ones', () => {
    const sections = groupQuestsByStatus([
      quest('locked_a', 'locked'),
      quest('active_a', 'active'),
      quest('available_a', 'available'),
      quest('turnin_a', 'completed'),
      quest('done_a', 'claimed'),
    ]);
    expect(sections.map((section) => section.key)).toEqual([
      'turnin',
      'active',
      'available',
      'locked',
      'done',
    ]);
    expect(sections[0]?.quests.map((entry) => entry.questId)).toEqual(['turnin_a']);
    expect(sections[1]?.quests.map((entry) => entry.questId)).toEqual(['active_a']);
  });

  it('keeps the server order inside a section and drops empty ones', () => {
    const sections = groupQuestsByStatus([
      quest('locked_a', 'locked'),
      quest('locked_b', 'locked'),
      quest('available_a', 'available'),
    ]);
    expect(sections.map((section) => section.key)).toEqual(['available', 'locked']);
    expect(sections[1]?.quests.map((entry) => entry.questId)).toEqual(['locked_a', 'locked_b']);
  });

  it('returns no sections for an empty catalogue', () => {
    expect(groupQuestsByStatus([])).toEqual([]);
  });
});

describe('nextAvailableQuest', () => {
  it('offers the story step before a repeatable daily', () => {
    const chosen = nextAvailableQuest([
      quest('quest_daily_slime_cleanup', 'available', 'daily'),
      quest('quest_slime_cleanup', 'available'),
    ]);
    expect(chosen?.questId).toBe('quest_slime_cleanup');
  });

  it('ignores locked and active quests', () => {
    const chosen = nextAvailableQuest([
      quest('quest_a', 'locked'),
      quest('quest_b', 'active'),
      quest('quest_c', 'available'),
    ]);
    expect(chosen?.questId).toBe('quest_c');
  });

  it('returns null when nothing can be accepted', () => {
    expect(nextAvailableQuest([quest('quest_a', 'claimed')])).toBeNull();
  });
});
