import type { QuestStatus, QuestView } from '@web-legend/contracts';
import { describe, expect, it } from 'vitest';

import { reachMarkersFor } from './reachMarkers';

function reachQuest(
  questId: string,
  status: QuestStatus,
  mapId = 'starter_town',
  progress = 0,
): QuestView {
  return {
    questId,
    title: `到达 ${questId}`,
    description: questId,
    giverNpcId: 'town_guard',
    giverNpcName: '守卫',
    levelRequirement: 1,
    status,
    progress,
    objective: {
      kind: 'reach',
      mapId,
      mapName: mapId,
      tile: { x: 35, y: 15 },
      radiusTiles: 2,
    },
    rewards: { exp: 5, gold: 5, items: [] },
  };
}

describe('reachMarkersFor', () => {
  it('marks only active arrival quests on the current map', () => {
    const markers = reachMarkersFor(
      [
        reachQuest('quest_town_east_gate', 'active'),
        reachQuest('quest_wilds_patrol', 'active', 'starter_wilds'),
        reachQuest('quest_town_locked', 'available'),
        reachQuest('quest_town_claimed', 'claimed', 'starter_town', 1),
      ],
      'starter_town',
    );
    expect(markers).toEqual([
      {
        questId: 'quest_town_east_gate',
        title: '到达 quest_town_east_gate',
        tile: { x: 35, y: 15 },
        radiusTiles: 2,
      },
    ]);
  });

  it('drops the marker once the server records arrival', () => {
    expect(
      reachMarkersFor(
        [reachQuest('quest_town_east_gate', 'active', 'starter_town', 1)],
        'starter_town',
      ),
    ).toEqual([]);
    expect(
      reachMarkersFor(
        [reachQuest('quest_town_east_gate', 'completed', 'starter_town', 1)],
        'starter_town',
      ),
    ).toEqual([]);
  });

  it('ignores kill and collect objectives', () => {
    const kill: QuestView = {
      ...reachQuest('quest_slimes', 'active'),
      objective: {
        kind: 'kill',
        monsterId: 'wild_slime',
        monsterName: '野地史莱姆',
        count: 3,
      },
    };
    expect(reachMarkersFor([kill], 'starter_town')).toEqual([]);
  });
});
