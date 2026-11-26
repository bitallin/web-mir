import type { ItemKind } from '@web-legend/contracts';
import type { CSSProperties } from 'react';

/**
 * Resolves an item to a frame in the placeholder icon atlas. Template ids win;
 * content that predates its icon falls back to the item kind, then to a generic
 * frame. The lookup is injected so the mapping stays a pure function.
 */
export type ItemIconLookup = {
  size: number;
  columns: number;
  templates: Readonly<Record<string, number>>;
  kinds: Readonly<Record<ItemKind, number>>;
  fallback: number;
};

export function itemIconFrame(lookup: ItemIconLookup, templateId: string, kind?: ItemKind): number {
  const direct = lookup.templates[templateId];
  if (direct !== undefined) {
    return direct;
  }
  if (kind !== undefined) {
    return lookup.kinds[kind];
  }
  return lookup.fallback;
}

export function itemIconStyle(
  atlasUrl: string,
  lookup: ItemIconLookup,
  templateId: string,
  kind?: ItemKind,
): CSSProperties {
  const frame = itemIconFrame(lookup, templateId, kind);
  const column = frame % lookup.columns;
  const row = Math.floor(frame / lookup.columns);
  return {
    width: `${String(lookup.size)}px`,
    height: `${String(lookup.size)}px`,
    backgroundImage: `url("${atlasUrl}")`,
    backgroundSize: `${String(lookup.columns * lookup.size)}px auto`,
    backgroundPosition: `${String(-column * lookup.size)}px ${String(-row * lookup.size)}px`,
  };
}
