import type {
  ContentBundle,
  DailyResetRule,
  QuestContent,
  QuestStatus,
  QuestView,
} from '@web-legend/contracts';

/**
 * Pure quest rules. Progress and rewards are owned by the server transaction;
 * this module only decides how a stored record maps to the view the browser
 * renders and how a kill advances one active objective (ADR-034 / ADR-038).
 */

export type QuestRecordState = {
  questId: string;
  /** Daily period key; empty for one-time quests. */
  periodKey: string;
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
  /** Current daily period key; empty when the release has no reset rule. */
  currentPeriodKey: string;
  /** Epoch millis of the next reset when the release declares `rules.dailyReset`. */
  nextResetAt?: number;
  /** Template id -> quantity in the bag, used by collect objectives (ADR-040). */
  inventory: ReadonlyMap<string, number>;
};

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/**
 * Start of the current daily period, expressed in realm-local milliseconds
 * (UTC offset folded in). Comparing wall-clock fields on that value keeps the
 * boundary stable without relying on the host timezone.
 */
function periodStartMs(now: Date, rule: DailyResetRule): number {
  const offsetMs = rule.utcOffsetMinutes * MS_PER_MINUTE;
  const localNow = now.getTime() + offsetMs;
  const local = new Date(localNow);
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const resetToday = localMidnight + rule.hour * MS_PER_HOUR;
  return localNow >= resetToday ? resetToday : resetToday - MS_PER_DAY;
}

/** Stable `YYYY-MM-DD` key for the realm day the timestamp belongs to. */
export function dailyPeriodKey(now: Date, rule: DailyResetRule): string {
  const start = new Date(periodStartMs(now, rule));
  return `${pad(start.getUTCFullYear(), 4)}-${pad(start.getUTCMonth() + 1, 2)}-${pad(
    start.getUTCDate(),
    2,
  )}`;
}

/** Epoch millis of the next realm reset, for countdowns and display. */
export function nextDailyResetAt(now: Date, rule: DailyResetRule): number {
  return periodStartMs(now, rule) + MS_PER_DAY - rule.utcOffsetMinutes * MS_PER_MINUTE;
}

function objectiveView(
  quest: QuestContent,
  context: Pick<QuestViewContext, 'items' | 'monsters'>,
): QuestView['objective'] {
  if (quest.objective.kind === 'kill') {
    return {
      kind: 'kill',
      monsterId: quest.objective.monsterId,
      monsterName: context.monsters[quest.objective.monsterId]?.name ?? quest.objective.monsterId,
      count: quest.objective.count,
    };
  }
  return {
    kind: 'collect',
    templateId: quest.objective.templateId,
    itemName: context.items[quest.objective.templateId]?.name ?? quest.objective.templateId,
    count: quest.objective.count,
  };
}

/** Items held in the bag, capped at the objective so the bar never overfills. */
function collectProgress(quest: QuestContent, context: QuestViewContext): number {
  if (quest.objective.kind !== 'collect') {
    return 0;
  }
  return Math.min(quest.objective.count, context.inventory.get(quest.objective.templateId) ?? 0);
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
  // A daily row from an earlier period is history, not the player's current
  // attempt: after the reset the quest must read as available again even if
  // the session still holds yesterday's claimed record (ADR-038).
  const effectiveRecord =
    record !== undefined &&
    (quest.repeat !== 'daily' || record.periodKey === context.currentPeriodKey)
      ? record
      : undefined;

  let status: QuestStatus;
  let progress = 0;
  if (effectiveRecord !== undefined) {
    status = effectiveRecord.status;
    progress = effectiveRecord.progress;
    // A collect quest is complete as soon as the bag holds enough items; the
    // claim transaction re-checks and consumes them (ADR-040). Nothing is
    // written on pickup, so the view is the single source of truth.
    if (quest.objective.kind === 'collect' && effectiveRecord.status === 'active') {
      progress = collectProgress(quest, context);
      if (progress >= quest.objective.count) {
        status = 'completed';
      }
    }
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
    ...(quest.repeat === undefined
      ? {}
      : {
          repeat: quest.repeat,
          ...(context.nextResetAt === undefined ? {} : { nextResetAt: context.nextResetAt }),
        }),
    status,
    progress,
    objective: objectiveView(quest, context),
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
  currentPeriodKey: string,
): QuestKillProgress | null {
  if (record === undefined || record.status !== 'active') {
    return null;
  }
  if (quest.repeat === 'daily' && record.periodKey !== currentPeriodKey) {
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
