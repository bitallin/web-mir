import type { QuestView } from '@web-legend/contracts';

/** An arrival objective that should be visible in the current map. */
export type ReachMarker = {
  questId: string;
  title: string;
  tile: { x: number; y: number };
  radiusTiles: number;
};

/**
 * Arrival markers are display only: an active reach quest on this map that the
 * server has not yet marked complete. The server still decides arrival, and a
 * completed or claimed quest must not leave a stale marker in the world
 * (TD-CLI-24).
 */
export function reachMarkersFor(quests: readonly QuestView[], mapId: string): ReachMarker[] {
  const markers: ReachMarker[] = [];
  for (const quest of quests) {
    const objective = quest.objective;
    if (quest.status !== 'active' || quest.progress >= 1) {
      continue;
    }
    if (objective.kind !== 'reach' || objective.mapId !== mapId) {
      continue;
    }
    markers.push({
      questId: quest.questId,
      title: quest.title,
      tile: objective.tile,
      radiusTiles: objective.radiusTiles,
    });
  }
  return markers;
}
