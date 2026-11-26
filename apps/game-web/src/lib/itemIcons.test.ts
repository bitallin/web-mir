import { describe, expect, it } from 'vitest';

import { itemIconFrame, itemIconStyle, type ItemIconLookup } from './itemIcons';

const LOOKUP: ItemIconLookup = {
  size: 32,
  columns: 8,
  templates: { slime_gel: 18, warrior_sword: 35 },
  kinds: { weapon: 37, armor: 38, consumable: 39, material: 40 },
  fallback: 41,
};

describe('item icon atlas lookup', () => {
  it('uses the explicit template frame before the kind fallback', () => {
    expect(itemIconFrame(LOOKUP, 'slime_gel', 'material')).toBe(18);
    expect(itemIconFrame(LOOKUP, 'warrior_sword', 'weapon')).toBe(35);
  });

  it('falls back to the item kind for content without an icon', () => {
    expect(itemIconFrame(LOOKUP, 'future_armor', 'armor')).toBe(38);
    expect(itemIconFrame(LOOKUP, 'future_potion', 'consumable')).toBe(39);
  });

  it('falls back to the generic frame when the kind is unknown', () => {
    expect(itemIconFrame(LOOKUP, 'mystery_drop')).toBe(41);
  });

  it('positions the frame inside the atlas', () => {
    const style = itemIconStyle('atlas.png', LOOKUP, 'slime_gel');
    // Frame 18 = column 2, row 2 of a 32px, 8-column atlas.
    expect(style.backgroundPosition).toBe('-64px -64px');
    expect(style.backgroundSize).toBe('256px auto');
    expect(style.backgroundImage).toBe('url("atlas.png")');
    expect(style.width).toBe('32px');
    expect(style.height).toBe('32px');
  });
});
