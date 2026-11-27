import type { QuestStatus, QuestView } from '@web-legend/contracts';

/**
 * Display-only ordering for the quest panel. The catalogue now spans a full
 * ten-step chain, so actionable quests are grouped ahead of locked ones while
 * the server keeps owning every status and progress value.
 */

export type QuestSectionKey = 'turnin' | 'active' | 'available' | 'locked' | 'done';

export type QuestSection = {
  key: QuestSectionKey;
  title: string;
  status: QuestStatus;
  quests: QuestView[];
};

const SECTIONS: readonly Omit<QuestSection, 'quests'>[] = [
  { key: 'turnin', title: '可交付', status: 'completed' },
  { key: 'active', title: '进行中', status: 'active' },
  { key: 'available', title: '可接取', status: 'available' },
  { key: 'locked', title: '尚未解锁', status: 'locked' },
  { key: 'done', title: '已领取', status: 'claimed' },
];

/**
 * Human label for an objective: monster name, "收集 <item>" or the arrival
 * destination with its map and tile (ADR-040 / ADR-042).
 */
export function questObjectiveLabel(objective: QuestView['objective']): string {
  if (objective.kind === 'kill') {
    return objective.monsterName;
  }
  if (objective.kind === 'collect') {
    return `收集 ${objective.itemName}`;
  }
  return `到达 ${objective.mapName}（${objective.tile.x},${objective.tile.y}）`;
}

/** Progress text; arrival objectives are binary rather than counted. */
export function questObjectiveProgressLabel(
  objective: QuestView['objective'],
  progress: number,
): string {
  if (objective.kind === 'reach') {
    return progress >= 1 ? '已到达' : '未到达';
  }
  return `${String(progress)}/${String(objective.count)}`;
}

export function groupQuestsByStatus(quests: readonly QuestView[]): QuestSection[] {
  return SECTIONS.map((section) => ({
    ...section,
    quests: quests.filter((quest) => quest.status === section.status),
  })).filter((section) => section.quests.length > 0);
}

/**
 * The hint above the world should guide a new player into the story before
 * offering a repeatable daily: one-time chain steps win, then the lowest level.
 */
export function nextAvailableQuest(quests: readonly QuestView[]): QuestView | null {
  const repeatRank = (quest: QuestView): number => (quest.repeat === undefined ? 0 : 1);
  const available = quests.filter((quest) => quest.status === 'available');
  available.sort(
    (left, right) =>
      repeatRank(left) - repeatRank(right) ||
      left.levelRequirement - right.levelRequirement ||
      left.questId.localeCompare(right.questId),
  );
  return available[0] ?? null;
}
