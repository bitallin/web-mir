import {
  CONTENT_SECTIONS,
  type ContentBundle,
  type ContentChange,
  type ContentSection,
} from '@web-legend/contracts';

import { canonicalJson } from './canonical';

export type ContentDiffSummary = {
  added: number;
  removed: number;
  changed: number;
};

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Optional content fields (buyPrice, mpRegenPerSecond, ...) can be absent on
 * either side of a diff. `canonicalJson` intentionally rejects undefined
 * content, so the diff handles absence explicitly instead of throwing.
 */
function jsonForDiff(value: unknown): string {
  return value === undefined ? 'undefined' : canonicalJson(value);
}

/** Sections are entity maps except `rules`, which is a map of rule names. */
function sectionRecord(section: unknown): RecordLike {
  return isRecord(section) ? section : {};
}

function changedFields(before: RecordLike, after: RecordLike): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => jsonForDiff(before[key]) !== jsonForDiff(after[key])).sort();
}

/**
 * Compares the current active bundle with a candidate. Entities are keyed by
 * their stable content id; nested objects are reported as one changed field
 * (for example `entries`) so the preview stays readable.
 */
export function diffContentBundles(
  before: ContentBundle | null,
  after: ContentBundle,
): ContentChange[] {
  const changes: ContentChange[] = [];

  for (const section of CONTENT_SECTIONS) {
    const beforeSection = sectionRecord(before?.[section]);
    const afterSection = sectionRecord(after[section]);
    const ids = new Set([...Object.keys(beforeSection), ...Object.keys(afterSection)]);
    for (const id of [...ids].sort()) {
      const beforeEntry = beforeSection[id];
      const afterEntry = afterSection[id];
      if (beforeEntry === undefined && afterEntry !== undefined) {
        changes.push({ section, id, kind: 'added', fields: [] });
        continue;
      }
      if (beforeEntry !== undefined && afterEntry === undefined) {
        changes.push({ section, id, kind: 'removed', fields: [] });
        continue;
      }
      if (isRecord(beforeEntry) && isRecord(afterEntry)) {
        const fields = changedFields(beforeEntry, afterEntry);
        if (fields.length > 0) {
          changes.push({ section, id, kind: 'changed', fields });
        }
      } else if (jsonForDiff(beforeEntry) !== jsonForDiff(afterEntry)) {
        changes.push({ section, id, kind: 'changed', fields: [] });
      }
    }
  }

  return changes;
}

export function summarizeChanges(changes: readonly ContentChange[]): ContentDiffSummary {
  const summary: ContentDiffSummary = { added: 0, removed: 0, changed: 0 };
  for (const change of changes) {
    summary[change.kind] += 1;
  }
  return summary;
}

export function changedSections(changes: readonly ContentChange[]): ContentSection[] {
  const sections = new Set<ContentSection>();
  for (const change of changes) {
    sections.add(change.section);
  }
  return CONTENT_SECTIONS.filter((section) => sections.has(section));
}
