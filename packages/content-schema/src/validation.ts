import {
  CONTENT_SECTIONS,
  contentBundleSchema,
  isMapTileWalkable,
  type ContentBundle,
  type ContentIssue,
  type ContentSection,
} from '@web-legend/contracts';
import { MAP_MANIFESTS } from '@web-legend/contracts/maps';

export type ContentValidationResult = {
  valid: boolean;
  bundle: ContentBundle | null;
  issues: ContentIssue[];
};

const MAX_ISSUES = 500;

function issue(
  issues: ContentIssue[],
  severity: ContentIssue['severity'],
  path: string,
  message: string,
): void {
  if (issues.length >= MAX_ISSUES) {
    return;
  }
  issues.push({ severity, path, message });
}

function zodPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return 'bundle';
  }
  return path.map((segment) => String(segment)).join('.');
}

function validateClasses(bundle: ContentBundle, issues: ContentIssue[]): void {
  for (const [key, definition] of Object.entries(bundle.classes)) {
    const path = `classes.${key}`;
    if (key !== definition.id) {
      issue(issues, 'error', path, `职业键名 "${key}" 与 id "${definition.id}" 不一致`);
    }
    const seen = new Set<string>();
    let hasClassWeapon = false;
    for (const [index, entry] of definition.starterKit.entries()) {
      const entryPath = `${path}.starterKit.${String(index)}`;
      const item = bundle.items[entry.templateId];
      if (item === undefined) {
        issue(issues, 'error', entryPath, `初始物品 "${entry.templateId}" 不存在`);
        continue;
      }
      if (seen.has(entry.templateId)) {
        issue(issues, 'error', entryPath, `初始物品 "${entry.templateId}" 重复`);
      }
      seen.add(entry.templateId);
      if (entry.quantity > item.maxStack) {
        issue(
          issues,
          'error',
          entryPath,
          `初始数量 ${String(entry.quantity)} 超过 "${entry.templateId}" 的堆叠上限 ${String(item.maxStack)}`,
        );
      }
      if (item.levelRequirement > 1) {
        issue(issues, 'error', entryPath, `初始物品 "${entry.templateId}" 需求等级高于 1`);
      }
      if (item.kind === 'weapon' || item.kind === 'armor') {
        if (item.classId !== undefined && item.classId !== key) {
          issue(
            issues,
            'error',
            entryPath,
            `初始装备 "${entry.templateId}" 限定职业 ${item.classId}，不能给 ${key}`,
          );
        }
        if (item.kind === 'weapon') {
          hasClassWeapon = true;
        }
      }
    }
    if (!hasClassWeapon) {
      issue(issues, 'error', path, '职业初始装备必须包含一件武器');
    }
  }
}

function validateSkills(bundle: ContentBundle, issues: ContentIssue[]): void {
  const hotkeys = new Map<string, Set<string>>();
  for (const [key, skill] of Object.entries(bundle.skills)) {
    const path = `skills.${key}`;
    if (key !== skill.id) {
      issue(issues, 'error', path, `技能键名 "${key}" 与 id "${skill.id}" 不一致`);
    }
    const classHotkeys = hotkeys.get(skill.classId) ?? new Set<string>();
    if (classHotkeys.has(skill.hotkey)) {
      issue(issues, 'error', path, `${skill.classId} 的快捷键 ${skill.hotkey} 已被占用`);
    }
    classHotkeys.add(skill.hotkey);
    hotkeys.set(skill.classId, classHotkeys);

    if (skill.effect.kind === 'heal' && skill.target !== 'self') {
      issue(issues, 'error', `${path}.target`, '治疗技能只能以自身为目标');
    }
    if (skill.effect.kind === 'shield' && skill.target !== 'self') {
      issue(issues, 'error', `${path}.target`, '护盾技能只能以自身为目标');
    }
    if (
      (skill.effect.kind === 'directDamage' || skill.effect.kind === 'dot') &&
      skill.target !== 'enemy'
    ) {
      issue(issues, 'error', `${path}.target`, '伤害技能必须以敌方为目标');
    }
    if (skill.effect.kind === 'dot') {
      if (skill.effect.durationMs < skill.effect.tickIntervalMs) {
        issue(issues, 'error', `${path}.effect.durationMs`, '持续伤害时长不能短于一个跳伤间隔');
      }
      if (skill.cooldownMs > 0 && skill.cooldownMs < skill.effect.durationMs) {
        issue(
          issues,
          'warning',
          `${path}.cooldownMs`,
          '冷却短于持续时间；重复施放只会刷新而不会叠层，剩余跳伤会被覆盖',
        );
      }
    }
  }

  for (const classId of Object.keys(bundle.classes)) {
    const skills = Object.values(bundle.skills).filter((skill) => skill.classId === classId);
    if (skills.length === 0) {
      issue(issues, 'error', `classes.${classId}`, '职业至少需要一个技能');
    }
  }
}

function validateMonsters(bundle: ContentBundle, issues: ContentIssue[]): void {
  for (const [key, monster] of Object.entries(bundle.monsters)) {
    const path = `monsters.${key}`;
    if (key !== monster.id) {
      issue(issues, 'error', path, `怪物键名 "${key}" 与 id "${monster.id}" 不一致`);
    }
    if (monster.leashTiles < monster.aggroTiles) {
      issue(issues, 'error', path, '脱战距离不能小于仇恨距离');
    }
    if (monster.moveSpeedUnitsPerSecond === 0) {
      issue(issues, 'warning', path, '怪物移动速度为 0，只会原地战斗');
    }
    if (monster.windupRadiusTiles !== undefined && (monster.windupMs ?? 0) === 0) {
      issue(issues, 'error', `${path}.windupRadiusTiles`, '设置了闪避半径但没有攻击前摇');
    }
    if (
      monster.windupMs !== undefined &&
      monster.windupMs > 0 &&
      monster.windupMs >= monster.attackIntervalMs
    ) {
      issue(issues, 'warning', `${path}.windupMs`, '攻击前摇不短于攻击间隔，节奏可能异常');
    }
    const table = bundle.lootTables[key];
    if (table === undefined) {
      issue(issues, 'error', path, `怪物 "${key}" 缺少掉落表`);
      continue;
    }
    if (monster.level > 100) {
      issue(issues, 'error', path, '怪物等级不能超过 100');
    }
    if (table.entries.length === 0) {
      issue(issues, 'warning', `lootTables.${key}`, '掉落表没有物品条目，只会给经验与金币');
    }
  }
}

function validateItems(bundle: ContentBundle, issues: ContentIssue[]): void {
  const looted = new Set<string>();
  for (const table of Object.values(bundle.lootTables)) {
    for (const entry of table.entries) {
      looted.add(entry.templateId);
    }
  }
  const starter = new Set<string>();
  for (const definition of Object.values(bundle.classes)) {
    for (const entry of definition.starterKit) {
      starter.add(entry.templateId);
    }
  }

  for (const [key, item] of Object.entries(bundle.items)) {
    const path = `items.${key}`;
    if (key !== item.id) {
      issue(issues, 'error', path, `物品键名 "${key}" 与 id "${item.id}" 不一致`);
    }
    if (item.quality !== undefined && item.kind !== 'weapon' && item.kind !== 'armor') {
      issue(issues, 'error', `${path}.quality`, '只有武器和防具可以设置品质');
    }

    const expectedSlot = item.kind === 'weapon' ? 'weapon' : item.kind === 'armor' ? 'armor' : null;
    if (expectedSlot === null) {
      if (item.equipSlot !== undefined) {
        issue(issues, 'error', `${path}.equipSlot`, `${item.kind} 不能装备`);
      }
      if (item.classId !== undefined) {
        issue(issues, 'error', `${path}.classId`, `${item.kind} 不能限定职业`);
      }
      if (
        item.attackBonus !== 0 ||
        item.defenseBonus !== 0 ||
        item.maxHpBonus !== 0 ||
        item.maxMpBonus !== 0
      ) {
        issue(issues, 'error', path, '非装备物品不能带属性加成');
      }
    } else if (item.equipSlot !== expectedSlot) {
      issue(issues, 'error', `${path}.equipSlot`, `${item.kind} 必须占用 ${expectedSlot} 槽`);
    }

    if (item.kind === 'consumable' && item.healHp === 0 && item.healMp === 0) {
      issue(issues, 'error', path, '消耗品必须恢复生命或法力');
    }
    if (!item.stackable && item.maxStack !== 1) {
      issue(issues, 'error', `${path}.maxStack`, '不可堆叠物品的堆叠上限必须为 1');
    }
    if (item.stackable && item.maxStack < 2) {
      issue(issues, 'error', `${path}.maxStack`, '可堆叠物品的堆叠上限必须大于 1');
    }

    const buyPrice = item.buyPrice ?? 0;
    const sellPrice = item.sellPrice ?? 0;
    if (buyPrice > 0 && sellPrice >= buyPrice) {
      issue(issues, 'error', path, '收购价必须低于出售价，否则玩家可无限兑换金币');
    }
    if (
      (item.kind === 'weapon' || item.kind === 'armor') &&
      buyPrice === 0 &&
      !looted.has(key) &&
      !starter.has(key)
    ) {
      issue(issues, 'warning', path, '装备当前无法获得：加入掉落表、设置出售价或作为初始装备');
    }
  }
}

function validateLootTables(bundle: ContentBundle, issues: ContentIssue[]): void {
  for (const [key, table] of Object.entries(bundle.lootTables)) {
    const path = `lootTables.${key}`;
    if (bundle.monsters[key] === undefined) {
      issue(issues, 'error', path, `掉落表 "${key}" 没有对应怪物`);
    }
    if (table.goldMax < table.goldMin) {
      issue(issues, 'error', path, '金币上限不能小于下限');
    }
    const templates = new Set<string>();
    for (const [index, entry] of table.entries.entries()) {
      const entryPath = `${path}.entries.${String(index)}`;
      if (bundle.items[entry.templateId] === undefined) {
        issue(issues, 'error', entryPath, `物品 "${entry.templateId}" 不存在`);
      }
      if (templates.has(entry.templateId)) {
        issue(issues, 'error', entryPath, `物品 "${entry.templateId}" 在同一掉落表中重复`);
      }
      templates.add(entry.templateId);
      if (entry.maxQuantity < entry.minQuantity) {
        issue(issues, 'error', entryPath, '数量上限不能小于下限');
      }
      const item = bundle.items[entry.templateId];
      if (item !== undefined && !item.stackable && entry.maxQuantity > 1) {
        issue(issues, 'warning', entryPath, `不可堆叠物品 "${entry.templateId}" 可能掉落多件`);
      }
    }
  }
}

function validateMaps(bundle: ContentBundle, issues: ContentIssue[]): void {
  const usedMonsters = new Set<string>();
  for (const map of MAP_MANIFESTS) {
    for (const [index, spawn] of map.monsterSpawns.entries()) {
      const path = `maps.${map.mapId}.monsterSpawns.${String(index)}`;
      if (bundle.monsters[spawn.monsterId] === undefined) {
        issue(issues, 'error', path, `刷点引用了不存在的怪物 "${spawn.monsterId}"`);
        continue;
      }
      usedMonsters.add(spawn.monsterId);
      if (!isMapTileWalkable(map, spawn.tile.x, spawn.tile.y)) {
        issue(
          issues,
          'error',
          path,
          `刷点 (${String(spawn.tile.x)}, ${String(spawn.tile.y)}) 不在可走区域`,
        );
      }
    }
  }
  for (const monsterId of Object.keys(bundle.monsters)) {
    if (!usedMonsters.has(monsterId)) {
      issue(issues, 'warning', `monsters.${monsterId}`, '没有地图刷点使用该怪物');
    }
  }
}

function validateRules(bundle: ContentBundle, issues: ContentIssue[]): void {
  const rule = bundle.rules?.deathPenalty;
  if (rule === undefined) {
    return;
  }
  if (rule.protectBelowLevel < 2) {
    issue(
      issues,
      'warning',
      'rules.deathPenalty.protectBelowLevel',
      '保护阈值低于 2 级时 1 级玩家也会损失经验',
    );
  }
  if (rule.xpLossPermille === 0) {
    issue(
      issues,
      'warning',
      'rules.deathPenalty.xpLossPermille',
      '死亡经验损失为 0，死亡不产生成长代价',
    );
  } else if (rule.xpLossPermille > 300) {
    issue(
      issues,
      'warning',
      'rules.deathPenalty.xpLossPermille',
      '单次死亡损失超过当前等级经验的 30%，可能让低等级玩家挫败',
    );
  }
}

/**
 * Schema and semantic validation. The returned bundle is present whenever the
 * JSON shape is valid, even if semantic errors remain, so the admin UI can
 * preview and fix a draft before publishing.
 */
export function validateContentBundle(input: unknown): ContentValidationResult {
  const parsed = contentBundleSchema.safeParse(input);
  if (!parsed.success) {
    const issues: ContentIssue[] = parsed.error.issues.slice(0, MAX_ISSUES).map((zodIssue) => ({
      severity: 'error',
      path: zodPath(zodIssue.path),
      message: zodIssue.message.slice(0, 300),
    }));
    return { valid: false, bundle: null, issues };
  }

  const issues: ContentIssue[] = [];
  validateClasses(parsed.data, issues);
  validateSkills(parsed.data, issues);
  validateMonsters(parsed.data, issues);
  validateItems(parsed.data, issues);
  validateLootTables(parsed.data, issues);
  validateRules(parsed.data, issues);
  validateMaps(parsed.data, issues);

  return {
    valid: issues.every((entry) => entry.severity !== 'error'),
    bundle: parsed.data,
    issues,
  };
}

export function assertValidContentBundle(bundle: unknown): ContentBundle {
  const result = validateContentBundle(bundle);
  if (!result.valid || result.bundle === null) {
    const first = result.issues.find((entry) => entry.severity === 'error');
    throw new Error(
      first === undefined
        ? 'content bundle is invalid'
        : `content bundle is invalid at ${first.path}: ${first.message}`,
    );
  }
  return result.bundle;
}

export function contentSectionsList(): readonly ContentSection[] {
  return CONTENT_SECTIONS;
}
