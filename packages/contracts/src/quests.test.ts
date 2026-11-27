import { describe, expect, it } from 'vitest';

import { questNavigateSchema, questNavigationSchema, questViewSchema } from './quests';

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

  it('accepts a collect objective with the resolved item name', () => {
    const parsed = questViewSchema.safeParse({
      ...DAILY_VIEW,
      repeat: undefined,
      nextResetAt: undefined,
      objective: {
        kind: 'collect',
        templateId: 'small_hp_potion',
        itemName: '金创药',
        count: 1,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a collect objective that carries kill-only fields', () => {
    const parsed = questViewSchema.safeParse({
      ...DAILY_VIEW,
      objective: {
        kind: 'collect',
        templateId: 'small_hp_potion',
        itemName: '金创药',
        monsterId: 'wild_slime',
        count: 1,
      },
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts an arrival objective with a resolved map and tile', () => {
    const parsed = questViewSchema.safeParse({
      ...DAILY_VIEW,
      repeat: undefined,
      nextResetAt: undefined,
      objective: {
        kind: 'reach',
        mapId: 'starter_wilds',
        mapName: '静语荒野',
        tile: { x: 40, y: 10 },
        radiusTiles: 2,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an arrival objective with an out-of-range radius or count', () => {
    const objective = {
      kind: 'reach',
      mapId: 'starter_wilds',
      mapName: '静语荒野',
      tile: { x: 40, y: 10 },
      radiusTiles: 6,
    };
    expect(questViewSchema.safeParse({ ...DAILY_VIEW, objective }).success).toBe(false);
    expect(
      questViewSchema.safeParse({
        ...DAILY_VIEW,
        objective: { ...objective, radiusTiles: 2, count: 1 },
      }).success,
    ).toBe(false);
  });
});

describe('quest navigation', () => {
  const command = {
    protocolVersion: 1,
    commandId: '0190a2b0-0000-7000-8000-000000000000',
    clientSequence: 4,
    questId: 'quest_daily_slime_cleanup',
    purpose: 'hunt',
  };

  it('accepts hunt, return, accept and stop intents', () => {
    for (const purpose of ['hunt', 'return', 'accept', 'stop'] as const) {
      expect(questNavigateSchema.safeParse({ ...command, purpose }).success).toBe(true);
    }
  });

  it('rejects an unknown navigation purpose or extra fields', () => {
    expect(questNavigateSchema.safeParse({ ...command, purpose: 'teleport' }).success).toBe(false);
    expect(questNavigateSchema.safeParse({ ...command, target: 'x' }).success).toBe(false);
  });

  it('describes server navigation with an optional map hop and reason', () => {
    expect(
      questNavigationSchema.safeParse({
        questId: command.questId,
        purpose: 'hunt',
        status: 'moving',
        mapId: 'starter_wilds',
        serverTime: 1,
      }).success,
    ).toBe(true);
    expect(
      questNavigationSchema.safeParse({
        questId: command.questId,
        purpose: 'return',
        status: 'stopped',
        reason: 'player_dead',
        serverTime: 1,
      }).success,
    ).toBe(true);
    expect(
      questNavigationSchema.safeParse({
        questId: command.questId,
        purpose: 'accept',
        status: 'arrived',
        serverTime: 1,
      }).success,
    ).toBe(true);
    expect(
      questNavigationSchema.safeParse({
        questId: command.questId,
        purpose: 'hunt',
        status: 'moving',
        reason: 'player_dead',
        serverTime: 1,
      }).success,
    ).toBe(false);
  });
});
