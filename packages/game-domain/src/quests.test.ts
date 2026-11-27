import { describe, expect, it } from 'vitest';

import type { DailyResetRule } from '@web-legend/contracts';
import { BASE_CONTENT_BUNDLE } from '@web-legend/content-schema/base';

import {
  advanceQuestOnKill,
  dailyPeriodKey,
  nextDailyResetAt,
  questViewFor,
  questViewsFor,
  type QuestRecordState,
} from './quests';

const NPC_NAMES = new Map([
  ['town_guard', '守卫'],
  ['town_merchant', '杂货商'],
]);

const DAILY_RULE: DailyResetRule = { hour: 5, utcOffsetMinutes: 480 };

function context(currentPeriodKey = '', nextResetAt?: number) {
  return {
    quests: BASE_CONTENT_BUNDLE.quests ?? {},
    items: BASE_CONTENT_BUNDLE.items,
    monsters: BASE_CONTENT_BUNDLE.monsters,
    npcNames: NPC_NAMES,
    currentPeriodKey,
    ...(nextResetAt === undefined ? {} : { nextResetAt }),
  };
}

function record(
  questId: string,
  status: QuestRecordState['status'],
  progress = 0,
  periodKey = '',
): QuestRecordState {
  return { questId, periodKey, status, progress };
}

describe('quest views', () => {
  it('locks quests until the level requirement is met', () => {
    const views = questViewsFor(context().quests, [], 1, {
      items: BASE_CONTENT_BUNDLE.items,
      monsters: BASE_CONTENT_BUNDLE.monsters,
      npcNames: NPC_NAMES,
      currentPeriodKey: '',
    });
    const first = views.find((view) => view.questId === 'quest_slime_cleanup');
    expect(first?.status).toBe('available');
    expect(first?.giverNpcName).toBe('守卫');
    expect(first?.objective).toMatchObject({ monsterName: '野地史莱姆', count: 3 });

    const lockedByLevel = views.find((view) => view.questId === 'quest_wolf_patrol');
    expect(lockedByLevel?.status).toBe('locked');
  });

  it('requires the prerequisite to be claimed, not merely completed', () => {
    const quests = context().quests;
    const quest = quests['quest_wolf_patrol'];
    if (quest === undefined) {
      throw new Error('missing quest fixture');
    }
    const completedOnly = questViewFor(
      quest,
      undefined,
      3,
      context(),
      new Map([['quest_slime_cleanup', record('quest_slime_cleanup', 'completed', 3)]]),
    );
    expect(completedOnly.status).toBe('locked');

    const claimed = questViewFor(
      quest,
      undefined,
      3,
      context(),
      new Map([['quest_slime_cleanup', record('quest_slime_cleanup', 'claimed', 3)]]),
    );
    expect(claimed.status).toBe('available');
    expect(claimed.prerequisiteTitle).toBe('清理史莱姆');
  });

  it('reports stored progress and resolved reward names', () => {
    const quest = context().quests['quest_slime_cleanup'];
    if (quest === undefined) {
      throw new Error('missing quest fixture');
    }
    const view = questViewFor(
      quest,
      record('quest_slime_cleanup', 'active', 2),
      2,
      context(),
      new Map(),
    );
    expect(view.status).toBe('active');
    expect(view.progress).toBe(2);
    expect(view.rewards.items[0]).toMatchObject({ templateId: 'small_hp_potion', name: '金创药' });
  });
});

describe('kill progress', () => {
  it('advances only the active quest whose monster was killed', () => {
    const quest = context().quests['quest_slime_cleanup'];
    if (quest === undefined) {
      throw new Error('missing quest fixture');
    }
    expect(
      advanceQuestOnKill(quest, record('quest_slime_cleanup', 'active', 0), 'forest_wolf', ''),
    ).toBeNull();
    expect(
      advanceQuestOnKill(quest, record('quest_slime_cleanup', 'completed', 3), 'wild_slime', ''),
    ).toBeNull();
    expect(advanceQuestOnKill(quest, undefined, 'wild_slime', '')).toBeNull();
    expect(
      advanceQuestOnKill(quest, record('quest_slime_cleanup', 'active', 1), 'wild_slime', ''),
    ).toEqual({
      progress: 2,
      completed: false,
    });
  });

  it('caps progress at the objective count and reports completion', () => {
    const quest = context().quests['quest_slime_cleanup'];
    if (quest === undefined) {
      throw new Error('missing quest fixture');
    }
    expect(
      advanceQuestOnKill(quest, record('quest_slime_cleanup', 'active', 2), 'wild_slime', ''),
    ).toEqual({
      progress: 3,
      completed: true,
    });
  });
});

describe('daily periods', () => {
  it('keys the period by the realm-local reset hour', () => {
    // 20:59Z is 04:59 at +08:00: still the previous realm day.
    expect(dailyPeriodKey(new Date('2026-11-27T20:59:00.000Z'), DAILY_RULE)).toBe('2026-11-27');
    // 21:00Z is the 05:00 reset and starts the next realm day.
    expect(dailyPeriodKey(new Date('2026-11-27T21:00:00.000Z'), DAILY_RULE)).toBe('2026-11-28');
    expect(nextDailyResetAt(new Date('2026-11-27T20:59:00.000Z'), DAILY_RULE)).toBe(
      Date.parse('2026-11-27T21:00:00.000Z'),
    );
  });

  it('shows a claimed daily as available again after the reset', () => {
    const quest = context().quests['quest_daily_slime_cleanup'];
    if (quest === undefined) {
      throw new Error('missing daily quest fixture');
    }
    const yesterday = record('quest_daily_slime_cleanup', 'claimed', 5, '2026-11-27');
    const today = context('2026-11-28', Date.parse('2026-11-29T21:00:00.000Z'));

    const reset = questViewFor(quest, yesterday, 1, today, new Map());
    expect(reset.status).toBe('available');
    expect(reset.progress).toBe(0);
    expect(reset.repeat).toBe('daily');
    expect(reset.nextResetAt).toBe(Date.parse('2026-11-29T21:00:00.000Z'));

    const current = questViewFor(quest, yesterday, 1, context('2026-11-27'), new Map());
    expect(current.status).toBe('claimed');
    expect(current.progress).toBe(5);
  });

  it('ignores daily progress earned in an earlier period', () => {
    const quest = context().quests['quest_daily_slime_cleanup'];
    if (quest === undefined) {
      throw new Error('missing daily quest fixture');
    }
    expect(
      advanceQuestOnKill(
        quest,
        record('quest_daily_slime_cleanup', 'active', 2, '2026-11-27'),
        'wild_slime',
        '2026-11-28',
      ),
    ).toBeNull();
    expect(
      advanceQuestOnKill(
        quest,
        record('quest_daily_slime_cleanup', 'active', 2, '2026-11-28'),
        'wild_slime',
        '2026-11-28',
      ),
    ).toEqual({ progress: 3, completed: false });
  });
});
