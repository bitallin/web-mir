import type { ContentBundle, QuestContent, QuestStatus, QuestView } from '@web-legend/contracts';

/**
 * Pure quest rules. Progress and rewards are owned by the server transaction;
 * this module only decides how a stored record maps to the view the browser
 * renders and how a kill advances one active objective (ADR-034).
 */

export type QuestRecordState = {
  questId: string;
  status: 'active' | 'completed' | 'claimed';
  progress: number;
};

export type QuestCatalog = Readonly<Record<string, QuestContent>>;

export type QuestViewContext = {
  quests: QuestCatalog;
  items: ContentBundle['items'];
  monsters: ContentBundle['monsters'];
  /** NPC display names from the compiled map the player is in. */
  npcNames: ReadonlyMap<string, string>;
};

function objectiveMonsterName(quest: QuestContent, context: QuestViewContext): string {
  return context.monsters[quest.objective.monsterId]?.name ?? quest.objective.monsterId;
}

function prerequisiteSatisfied(
  quest: QuestContent,
  records: ReadonlyMap<string, QuestRecordState>,
): boolean {
  if (quest.prerequisiteQuestId === undefined) {
    return true;
  }
  return records.get(quest.prerequisiteQuestId)?.status === 'claimed';
}

export function questViewFor(
  quest: QuestContent,
  record: QuestRecordState | undefined,
  characterLevel: number,
  context: QuestViewContext,
  records: ReadonlyMap<string, QuestRecordState>,
): QuestView {
  let status: QuestStatus;
  if (record !== undefined) {
    status = record.status;
  } else if (characterLevel < quest.levelRequirement || !prerequisiteSatisfied(quest, records)) {
    status = 'locked';
  } else {
    status = 'available';
  }

  const prerequisite =
    quest.prerequisiteQuestId === undefined ? undefined : context.quests[quest.prerequisiteQuestId];

  return {
    questId: quest.id,
    title: quest.title,
    description: quest.description,
    giverNpcId: quest.giverNpcId,
    giverNpcName: context.npcNames.get(quest.giverNpcId) ?? quest.giverNpcId,
    levelRequirement: quest.levelRequirement,
    ...(quest.prerequisiteQuestId === undefined
      ? {}
      : { prerequisiteQuestId: quest.prerequisiteQuestId }),
    ...(prerequisite === undefined ? {} : { prerequisiteTitle: prerequisite.title }),
    status,
    progress: record?.progress ?? 0,
    objective: {
      kind: 'kill',
      monsterId: quest.objective.monsterId,
      monsterName: objectiveMonsterName(quest, context),
      count: quest.objective.count,
    },
    rewards: {
      exp: quest.rewards.exp,
      gold: quest.rewards.gold,
      items: quest.rewards.items.map((entry) => ({
        templateId: entry.templateId,
        name: context.items[entry.templateId]?.name ?? entry.templateId,
        quantity: entry.quantity,
      })),
    },
  };
}

/** Stable order: cheapest/earliest quest first, then content id. */
export function questViewsFor(
  quests: QuestCatalog,
  records: readonly QuestRecordState[],
  characterLevel: number,
  context: Omit<QuestViewContext, 'quests'>,
): QuestView[] {
  const byId = new Map(records.map((record) => [record.questId, record]));
  return Object.values(quests)
    .sort(
      (left, right) =>
        left.levelRequirement - right.levelRequirement || left.id.localeCompare(right.id),
    )
    .map((quest) =>
      questViewFor(quest, byId.get(quest.id), characterLevel, { ...context, quests }, byId),
    );
}

export type QuestKillProgress = { progress: number; completed: boolean };

/**
 * Returns the new progress for one kill, or `null` when the quest is not
 * active or the killed monster is not its target.
 */
export function advanceQuestOnKill(
  quest: QuestContent,
  record: QuestRecordState | undefined,
  monsterId: string,
): QuestKillProgress | null {
  if (record === undefined || record.status !== 'active') {
    return null;
  }
  if (quest.objective.kind !== 'kill' || quest.objective.monsterId !== monsterId) {
    return null;
  }
  if (record.progress >= quest.objective.count) {
    return null;
  }
  const progress = Math.min(quest.objective.count, record.progress + 1);
  return { progress, completed: progress >= quest.objective.count };
}

/** True when the quest is known to this bundle. */
export function requireQuest(quests: QuestCatalog, questId: string): QuestContent {
  const quest = quests[questId];
  if (quest === undefined) {
    throw new RangeError(`unknown quest "${questId}"`);
  }
  return quest;
}
