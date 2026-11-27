import { describe, expect, it } from 'vitest';

import { questViewSchema } from './quests';

const DAILY_VIEW = {
  questId: 'quest_daily_slime_cleanup',
  title: '每日：清理史莱姆',
  description: '击杀 5 只史莱姆，回来领取今日报酬。',
  giverNpcId: 'town_guard',
  giverNpcName: '守卫',
  levelRequirement: 1,
  status: 'available',
  progress: 0,
  objective: { kind: 'kill', monsterId: 'wild_slime', monsterName: '野地史莱姆', count: 5 },
  rewards: { exp: 50, gold: 15, items: [] },
  repeat: 'daily',
  nextResetAt: 1_793_000_000_000,
};

describe('quest views', () => {
  it('accepts a daily quest with its next reset', () => {
    const parsed = questViewSchema.safeParse(DAILY_VIEW);
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown repeat kind', () => {
    const parsed = questViewSchema.safeParse({ ...DAILY_VIEW, repeat: 'weekly' });
    expect(parsed.success).toBe(false);
  });

  it('rejects a negative reset time', () => {
    const parsed = questViewSchema.safeParse({ ...DAILY_VIEW, nextResetAt: -1 });
    expect(parsed.success).toBe(false);
  });
});
