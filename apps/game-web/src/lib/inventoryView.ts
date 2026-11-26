import type { ItemKind, ItemQuality, ItemView } from '@web-legend/contracts';

/**
 * Display-only helpers for the bag panel. Ordering and comparison never change
 * what the server stores: slot indices, equipment and stats stay authoritative.
 */

export const QUALITY_LABELS: Record<ItemQuality, string> = {
  common: '普通',
  rare: '稀有',
};

export function qualityOf(item: Pick<ItemView, 'quality'>): ItemQuality {
  return item.quality ?? 'common';
}

export type StatDelta = {
  attack: number;
  defense: number;
  maxHp: number;
  maxMp: number;
};

type ItemBonuses = Pick<ItemView, 'attackBonus' | 'defenseBonus' | 'maxHpBonus' | 'maxMpBonus'>;

const NO_BONUSES: ItemBonuses = {
  attackBonus: 0,
  defenseBonus: 0,
  maxHpBonus: 0,
  maxMpBonus: 0,
};

/** How equipping `candidate` would change the stats of the slot it occupies. */
export function equipmentDelta(equipped: ItemBonuses | null, candidate: ItemBonuses): StatDelta {
  const current = equipped ?? NO_BONUSES;
  return {
    attack: candidate.attackBonus - current.attackBonus,
    defense: candidate.defenseBonus - current.defenseBonus,
    maxHp: candidate.maxHpBonus - current.maxHpBonus,
    maxMp: candidate.maxMpBonus - current.maxMpBonus,
  };
}

const DELTA_LABELS: readonly [keyof StatDelta, string][] = [
  ['attack', '攻击'],
  ['defense', '防御'],
  ['maxHp', '生命'],
  ['maxMp', '法力'],
];

/** Human-readable stat line such as "攻击 +3 · 生命 +15"; empty when equal. */
export function describeDelta(delta: StatDelta): string {
  return DELTA_LABELS.filter(([key]) => delta[key] !== 0)
    .map(([key, label]) => `${label} ${delta[key] > 0 ? '+' : ''}${String(delta[key])}`)
    .join(' · ');
}

export type ItemStatSource = Pick<
  ItemView,
  'kind' | 'attackBonus' | 'defenseBonus' | 'maxHpBonus' | 'maxMpBonus' | 'healHp' | 'healMp'
>;

/**
 * Every stat an item actually carries. The bag, the equipment slots and the
 * merchant all use this so a bonus can never be shown in one place and hidden
 * in another.
 */
export function itemStatLine(item: ItemStatSource): string {
  if (item.kind === 'weapon' || item.kind === 'armor') {
    const parts: string[] = [];
    if (item.attackBonus > 0) {
      parts.push(`攻击 +${String(item.attackBonus)}`);
    }
    if (item.defenseBonus > 0) {
      parts.push(`防御 +${String(item.defenseBonus)}`);
    }
    if (item.maxHpBonus > 0) {
      parts.push(`生命 +${String(item.maxHpBonus)}`);
    }
    if (item.maxMpBonus > 0) {
      parts.push(`法力 +${String(item.maxMpBonus)}`);
    }
    return parts.length > 0 ? parts.join(' · ') : '无属性加成';
  }
  if (item.kind === 'consumable') {
    const parts: string[] = [];
    if (item.healHp > 0) {
      parts.push(`${String(item.healHp)} HP`);
    }
    if (item.healMp > 0) {
      parts.push(`${String(item.healMp)} MP`);
    }
    return parts.length > 0 ? `回复 ${parts.join(' · ')}` : '无回复效果';
  }
  return '材料';
}

const QUALITY_RANK: Record<ItemQuality, number> = { rare: 1, common: 0 };
const KIND_RANK: Record<ItemKind, number> = { weapon: 0, armor: 0, consumable: 1, material: 2 };

/** Groups equipment first, then consumables and materials, rare items on top. */
export function sortBagItems(items: readonly ItemView[]): ItemView[] {
  return [...items].sort(
    (left, right) =>
      KIND_RANK[left.kind] - KIND_RANK[right.kind] ||
      QUALITY_RANK[qualityOf(right)] - QUALITY_RANK[qualityOf(left)] ||
      right.levelRequirement - left.levelRequirement ||
      left.name.localeCompare(right.name, 'zh-Hans-CN') ||
      (left.slotIndex ?? 0) - (right.slotIndex ?? 0),
  );
}
