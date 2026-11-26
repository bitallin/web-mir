import { describe, expect, it } from 'vitest';

import type { ItemView } from '@web-legend/contracts';

import {
  describeDelta,
  equipmentDelta,
  itemStatLine,
  qualityOf,
  sortBagItems,
} from './inventoryView';

function item(overrides: Partial<ItemView> & Pick<ItemView, 'itemId' | 'templateId'>): ItemView {
  return {
    name: overrides.templateId,
    kind: 'weapon',
    quantity: 1,
    levelRequirement: 1,
    attackBonus: 0,
    defenseBonus: 0,
    maxHpBonus: 0,
    maxMpBonus: 0,
    healHp: 0,
    healMp: 0,
    ...overrides,
  };
}

describe('equipment comparison', () => {
  it('treats an empty slot as zero bonuses', () => {
    const delta = equipmentDelta(null, item({ itemId: 'a', templateId: 'cloth', defenseBonus: 2 }));
    expect(delta).toEqual({ attack: 0, defense: 2, maxHp: 0, maxMp: 0 });
  });

  it('reports gains and losses against the equipped item', () => {
    const equipped = item({
      itemId: 'a',
      templateId: 'leather',
      defenseBonus: 5,
      maxHpBonus: 15,
    });
    const candidate = item({
      itemId: 'b',
      templateId: 'plate',
      defenseBonus: 11,
      maxHpBonus: 5,
    });
    expect(equipmentDelta(equipped, candidate)).toEqual({
      attack: 0,
      defense: 6,
      maxHp: -10,
      maxMp: 0,
    });
  });

  it('describes only non-zero deltas with signs', () => {
    expect(describeDelta({ attack: 3, defense: 0, maxHp: -10, maxMp: 0 })).toBe(
      '攻击 +3 · 生命 -10',
    );
    expect(describeDelta({ attack: 0, defense: 0, maxHp: 0, maxMp: 0 })).toBe('');
  });

  it('defaults an unlabelled item to common quality', () => {
    expect(qualityOf({})).toBe('common');
    expect(qualityOf({ quality: 'rare' })).toBe('rare');
  });
});

describe('bag sorting', () => {
  it('puts equipment first, then consumables, then materials', () => {
    const sorted = sortBagItems([
      item({ itemId: 'm', templateId: 'gel', kind: 'material', name: '史莱姆凝胶' }),
      item({ itemId: 'c', templateId: 'potion', kind: 'consumable', name: '金创药' }),
      item({ itemId: 'w', templateId: 'sword', name: '铁剑' }),
    ]);
    expect(sorted.map((entry) => entry.itemId)).toEqual(['w', 'c', 'm']);
  });

  it('orders rare equipment before common and higher level first', () => {
    const sorted = sortBagItems([
      item({ itemId: 'common5', templateId: 'iron', levelRequirement: 5, name: '玄铁巨剑' }),
      item({
        itemId: 'rare7',
        templateId: 'flame',
        levelRequirement: 7,
        quality: 'rare',
        name: '烈焰斩马刀',
      }),
      item({ itemId: 'common3', templateId: 'axe', levelRequirement: 3, name: '百炼战斧' }),
    ]);
    expect(sorted.map((entry) => entry.itemId)).toEqual(['rare7', 'common5', 'common3']);
  });

  it('does not mutate the snapshot order', () => {
    const items = [
      item({ itemId: 'm', templateId: 'gel', kind: 'material' }),
      item({ itemId: 'w', templateId: 'sword' }),
    ];
    sortBagItems(items);
    expect(items.map((entry) => entry.itemId)).toEqual(['m', 'w']);
  });
});

describe('item stat line', () => {
  it('lists every bonus an equipment piece carries', () => {
    expect(
      itemStatLine(
        item({
          itemId: 'a',
          templateId: 'flame',
          attackBonus: 36,
          maxHpBonus: 20,
        }),
      ),
    ).toBe('攻击 +36 · 生命 +20');
    expect(
      itemStatLine(
        item({
          itemId: 'b',
          templateId: 'soul',
          attackBonus: 20,
          maxHpBonus: 20,
          maxMpBonus: 10,
        }),
      ),
    ).toBe('攻击 +20 · 生命 +20 · 法力 +10');
    expect(
      itemStatLine(
        item({
          itemId: 'c',
          templateId: 'chain',
          kind: 'armor',
          defenseBonus: 7,
          maxHpBonus: 25,
        }),
      ),
    ).toBe('防御 +7 · 生命 +25');
  });

  it('shows a single stat without padding', () => {
    expect(
      itemStatLine(item({ itemId: 'd', templateId: 'cloth', kind: 'armor', defenseBonus: 2 })),
    ).toBe('防御 +2');
  });

  it('describes consumables, empty gear and materials', () => {
    expect(
      itemStatLine(
        item({ itemId: 'e', templateId: 'potion', kind: 'consumable', healHp: 40, healMp: 30 }),
      ),
    ).toBe('回复 40 HP · 30 MP');
    expect(
      itemStatLine(item({ itemId: 'f', templateId: 'potion', kind: 'consumable', healMp: 30 })),
    ).toBe('回复 30 MP');
    expect(itemStatLine(item({ itemId: 'g', templateId: 'odd' }))).toBe('无属性加成');
    expect(itemStatLine(item({ itemId: 'h', templateId: 'gel', kind: 'material' }))).toBe('材料');
  });
});
