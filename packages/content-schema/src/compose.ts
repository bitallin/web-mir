import {
  CONTENT_SECTIONS,
  type ContentBundle,
  type ContentSection,
  type ContentSectionData,
} from '@web-legend/contracts';

export type DraftSections = Partial<Record<ContentSection, unknown>>;

/**
 * Applies every saved draft section on top of the base bundle. The result is
 * returned unvalidated; callers run `validateContentBundle` before publishing.
 */
export function composeContentBundle(base: ContentBundle, drafts: DraftSections): unknown {
  const candidate: Record<string, unknown> = { ...base };
  for (const section of CONTENT_SECTIONS) {
    const draft = drafts[section];
    if (draft !== undefined) {
      candidate[section] = draft;
    }
  }
  return candidate;
}

export function sectionData(
  bundle: ContentBundle,
  section: ContentSection,
): ContentSectionData[ContentSection] | undefined {
  return bundle[section];
}

export function buildReleaseVersion(date: Date, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('release sequence must be a positive integer');
  }
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}.${month}.${day}.${String(sequence)}`;
}
