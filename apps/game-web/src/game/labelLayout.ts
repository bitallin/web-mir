export type LabelRect = { x: number; y: number; width: number; height: number };

export type LabelCandidate = {
  /** Stable identity used by the scene to apply the result. */
  id: string;
  /** Higher wins when labels collide: self > target > NPC > players > monsters. */
  priority: number;
  /** World-space distance to the current focus; nearer wins among equals. */
  distance: number;
  rect: LabelRect;
};

/** Keeps adjacent plates from visually touching once one is hidden. */
export const LABEL_PADDING = 3;

export function rectsOverlap(a: LabelRect, b: LabelRect, padding: number = LABEL_PADDING): boolean {
  return (
    a.x < b.x + b.width + padding &&
    b.x < a.x + a.width + padding &&
    a.y < b.y + b.height + padding &&
    b.y < a.y + a.height + padding
  );
}

function compareCandidates(a: LabelCandidate, b: LabelCandidate): number {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }
  if (a.distance !== b.distance) {
    return a.distance - b.distance;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Greedy screen-space declutter: the most important label keeps its place and
 * every label that would touch it is hidden. Positions never move, so a label
 * cannot flicker between two offsets while entities walk past each other.
 */
export function resolveVisibleLabels(candidates: readonly LabelCandidate[]): Set<string> {
  const visible = new Set<string>();
  const placed: LabelRect[] = [];
  for (const candidate of [...candidates].sort(compareCandidates)) {
    if (placed.some((rect) => rectsOverlap(candidate.rect, rect))) {
      continue;
    }
    placed.push(candidate.rect);
    visible.add(candidate.id);
  }
  return visible;
}
