/**
 * Regenerates the item icon atlas under `generated/`.
 *
 * These are procedural placeholders in the same visual language as the class
 * sheets: one recognisable silhouette per item family, coloured per item, with
 * a dark shadow so the icon reads on the HUD's dark panels. The manifest maps
 * every baseline template id to a frame, and the script refuses to run when a
 * content item has no icon, so a release cannot render an empty square.
 *
 * Run with `pnpm assets:generate`. Output is deterministic.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE_CONTENT_BUNDLE } from '../../packages/content-schema/src/index';
import { encodePng, Raster, rgb, type Rgba } from './raster';

const ICON_SIZE = 32;
const COLUMNS = 8;
const ROWS = 6;
const SHADOW: Rgba = [0, 0, 0, 70];
const CLEAR: Rgba = [0, 0, 0, 0];

type Shape =
  | 'sword'
  | 'axe'
  | 'staff'
  | 'armor'
  | 'potion'
  | 'gel'
  | 'pelt'
  | 'leg'
  | 'core'
  | 'crystal'
  | 'bone';

type Spec = {
  shape: Shape;
  /** The item's defining colour: blade, liquid, orb or hide. */
  main: Rgba;
  /** Highlights and trim. */
  accent: Rgba;
  /** Outlines and the side turned away from the light. */
  shade: Rgba;
};

function spec(shape: Shape, main: number, accent: number, shade: number): Spec {
  return { shape, main: rgb(main), accent: rgb(accent), shade: rgb(shade) };
}

/** Every baseline item template. The key is the `items` id in content. */
const ITEM_ICONS: Record<string, Spec> = {
  // Warrior weapons.
  warrior_sword: spec('sword', 0xc8ccd4, 0xf2f5f8, 0x7b818b),
  warrior_battle_axe: spec('axe', 0xc98b45, 0xf0d29a, 0x7b4f22),
  warrior_iron_blade: spec('sword', 0x9aa3ad, 0xd6dde5, 0x555c66),
  warrior_flame_cleaver: spec('sword', 0xd9563f, 0xffc06b, 0x7d2418),
  warrior_steel_greataxe: spec('axe', 0x9fb6c9, 0xe3f0ff, 0x53697c),
  warrior_ruin_cleaver: spec('sword', 0xb06ad4, 0xf2c9ff, 0x5c2f75),
  // Mage weapons.
  mage_staff: spec('staff', 0x7fd6a0, 0xe8ffe8, 0x6b4e2a),
  mage_jade_staff: spec('staff', 0x6fcf9b, 0xd8ffe6, 0x527a58),
  mage_storm_staff: spec('staff', 0x6fb8ff, 0xdff2ff, 0x3d5875),
  mage_void_scepter: spec('staff', 0xb06fe0, 0xefd6ff, 0x4a2f63),
  mage_mithril_staff: spec('staff', 0xd7e3f0, 0xffffff, 0x7a8a9a),
  mage_ruin_scepter: spec('staff', 0xc46bff, 0xf6dcff, 0x5a2f7a),
  // Taoist weapons.
  taoist_blade: spec('sword', 0x86c9a3, 0xe4f5d8, 0x3f7359),
  taoist_wood_sword: spec('sword', 0xb08d5a, 0xe8d2a2, 0x6b4e2a),
  taoist_soul_sword: spec('sword', 0x5fc9c1, 0xc8fffb, 0x2a6c68),
  taoist_immortal_sword: spec('sword', 0xe0b258, 0xfff0b8, 0x8a6520),
  taoist_moon_sword: spec('sword', 0xa9c6ec, 0xf0f8ff, 0x4d6685),
  taoist_ruin_blade: spec('sword', 0x9b6be0, 0xe6ccff, 0x4c2f7a),
  // Armour.
  cloth_armor: spec('armor', 0x9a8f7a, 0xd8cbb2, 0x5f584b),
  leather_armor: spec('armor', 0x9c6b3f, 0xd9a774, 0x5e3d20),
  chain_armor: spec('armor', 0x8f9aa8, 0xd2dbe4, 0x555e68),
  plate_armor: spec('armor', 0xb9c2cc, 0xf2f6fa, 0x6a737d),
  alpha_hide_armor: spec('armor', 0xb98a4f, 0xffd98a, 0x6a4a20),
  stone_plate_armor: spec('armor', 0x8f8f86, 0xd6d2c4, 0x56564f),
  gargoyle_guard_armor: spec('armor', 0x7c7f8a, 0xc9ccd6, 0x45474f),
  // Potions.
  small_hp_potion: spec('potion', 0xe05b5b, 0xffc4b0, 0x8a3a3a),
  large_hp_potion: spec('potion', 0xf06a5a, 0xffd8c8, 0x8a3a3a),
  small_mp_potion: spec('potion', 0x5b8ee0, 0xc4dcff, 0x35507a),
  large_mp_potion: spec('potion', 0x6aa8f0, 0xd0e8ff, 0x35507a),
  // Materials.
  slime_gel: spec('gel', 0x8fc46b, 0xdaf5b0, 0x4f7a35),
  wolf_pelt: spec('pelt', 0xa89274, 0xe0cfae, 0x6a563c),
  alpha_pelt: spec('pelt', 0xc9b28a, 0xfff0c8, 0x7a6440),
  spider_leg: spec('leg', 0x6b7a8a, 0xb9c9d8, 0x3a4450),
  stone_core: spec('core', 0x8f9aa0, 0xd6e2e8, 0x4f585e),
  gargoyle_core: spec('core', 0x7c8a7c, 0xc9dcc9, 0x3f4a3f),
  bone_shard: spec('bone', 0xe6ddc4, 0xfffaf0, 0x9a8f74),
  corrupt_crystal: spec('crystal', 0xa46be0, 0xf0d0ff, 0x5a2f7a),
};

/** Used when a future content release adds an item before its icon exists. */
const KIND_ICONS: Record<'weapon' | 'armor' | 'consumable' | 'material', Spec> = {
  weapon: spec('sword', 0xc8ccd4, 0xf2f5f8, 0x7b818b),
  armor: spec('armor', 0xb9c2cc, 0xf2f6fa, 0x6a737d),
  consumable: spec('potion', 0x8fc46b, 0xdaf5b0, 0x4f7a35),
  material: spec('core', 0x8f9aa0, 0xd6e2e8, 0x4f585e),
};

const FALLBACK_ICON = spec('core', 0x8a8f96, 0xc9ced6, 0x4b4f55);

function drawSword(raster: Raster, { main, accent, shade }: Spec): void {
  raster.ellipse(16, 28, 9, 2, SHADOW);
  raster.line(11, 22, 24, 5, shade);
  raster.line(12, 22, 25, 5, main);
  raster.line(13, 21, 25, 4, accent);
  raster.line(9, 24, 15, 18, accent);
  raster.line(10, 25, 16, 19, accent);
  raster.line(9, 26, 6, 29, shade);
  raster.line(10, 27, 7, 30, main);
  raster.ellipse(6, 29, 2, 2, accent);
}

function drawAxe(raster: Raster, { main, accent, shade }: Spec): void {
  raster.ellipse(16, 28, 9, 2, SHADOW);
  raster.line(9, 27, 22, 6, shade);
  raster.line(10, 27, 23, 6, accent);
  raster.ellipse(23, 8, 7, 8, main);
  raster.ellipse(25, 8, 4, 6, CLEAR);
  raster.line(17, 2, 17, 14, accent);
  raster.line(18, 2, 18, 14, main);
}

function drawStaff(raster: Raster, { main, accent, shade }: Spec): void {
  raster.ellipse(16, 28, 8, 2, SHADOW);
  raster.line(10, 28, 21, 8, shade);
  raster.line(11, 28, 22, 8, accent);
  raster.ellipse(22, 7, 5, 5, shade);
  raster.ellipse(22, 7, 4, 4, main);
  raster.ellipse(20, 5, 1, 1, accent);
  raster.pixel(26, 9, accent);
  raster.pixel(27, 11, main);
}

function drawArmor(raster: Raster, { main, accent, shade }: Spec): void {
  raster.ellipse(16, 29, 9, 2, SHADOW);
  raster.rect(7, 9, 5, 5, shade);
  raster.rect(20, 9, 5, 5, shade);
  raster.rect(22, 13, 3, 4, main);
  raster.rect(10, 9, 12, 14, main);
  raster.rect(10, 9, 3, 14, shade);
  raster.rect(14, 7, 4, 4, accent);
  raster.rect(14, 13, 4, 1, accent);
  raster.rect(10, 20, 12, 2, accent);
  raster.rect(9, 23, 14, 2, shade);
  raster.rect(15, 23, 2, 2, accent);
}

function drawPotion(raster: Raster, { main, accent, shade }: Spec): void {
  raster.ellipse(16, 29, 8, 2, SHADOW);
  raster.rect(13, 3, 6, 3, shade);
  raster.rect(14, 6, 5, 4, accent);
  raster.ellipse(16, 20, 8, 7, shade);
  raster.ellipse(16, 21, 6, 5, main);
  raster.rect(12, 17, 2, 3, accent);
  raster.pixel(13, 16, accent);
}

function drawGel(raster: Raster, { main, accent, shade }: Spec): void {
  raster.ellipse(16, 29, 8, 2, SHADOW);
  raster.ellipse(16, 20, 8, 6, shade);
  raster.ellipse(16, 18, 8, 6, main);
  raster.ellipse(16, 13, 5, 4, main);
  raster.ellipse(13, 14, 2, 1, accent);
  raster.rect(9, 23, 2, 2, main);
  raster.rect(23, 24, 2, 1, shade);
}

function drawPelt(raster: Raster, { main, accent, shade }: Spec): void {
  raster.ellipse(16, 29, 9, 2, SHADOW);
  raster.ellipse(16, 17, 9, 7, shade);
  raster.ellipse(16, 16, 9, 7, main);
  raster.ellipse(12, 24, 3, 3, CLEAR);
  raster.ellipse(20, 24, 3, 3, CLEAR);
  raster.rect(12, 13, 8, 1, accent);
  raster.rect(15, 16, 2, 5, accent);
}

function drawLeg(raster: Raster, { main, accent, shade }: Spec): void {
  raster.ellipse(16, 29, 9, 2, SHADOW);
  raster.line(9, 25, 22, 6, shade);
  raster.line(10, 25, 23, 6, main);
  raster.line(11, 25, 24, 6, main);
  raster.ellipse(10, 24, 3, 3, shade);
  raster.ellipse(23, 7, 3, 3, main);
  raster.line(24, 7, 28, 3, accent);
  raster.line(22, 10, 27, 8, accent);
}

function drawCore(raster: Raster, { main, accent, shade }: Spec): void {
  raster.ellipse(16, 29, 8, 2, SHADOW);
  raster.ellipse(16, 19, 8, 7, shade);
  raster.ellipse(16, 18, 7, 6, main);
  raster.line(11, 21, 21, 12, shade);
  raster.line(12, 13, 20, 21, shade);
  raster.ellipse(14, 15, 2, 2, accent);
}

function drawCrystal(raster: Raster, { main, accent, shade }: Spec): void {
  raster.ellipse(16, 29, 8, 2, SHADOW);
  raster.ellipse(16, 18, 5, 9, shade);
  raster.line(16, 4, 12, 20, accent);
  raster.line(16, 4, 20, 20, main);
  raster.line(12, 20, 16, 28, main);
  raster.line(20, 20, 16, 28, shade);
  raster.line(16, 6, 16, 27, accent);
  raster.pixel(14, 16, accent);
}

function drawBone(raster: Raster, { main, accent, shade }: Spec): void {
  raster.ellipse(16, 29, 8, 2, SHADOW);
  raster.line(9, 25, 22, 9, shade);
  raster.line(10, 25, 23, 9, main);
  raster.line(11, 25, 24, 9, accent);
  raster.ellipse(9, 25, 3, 3, main);
  raster.ellipse(11, 27, 2, 2, accent);
  raster.ellipse(23, 9, 3, 3, main);
  raster.ellipse(21, 7, 2, 2, accent);
}

const PAINTERS: Record<Shape, (raster: Raster, spec: Spec) => void> = {
  sword: drawSword,
  axe: drawAxe,
  staff: drawStaff,
  armor: drawArmor,
  potion: drawPotion,
  gel: drawGel,
  pelt: drawPelt,
  leg: drawLeg,
  core: drawCore,
  crystal: drawCrystal,
  bone: drawBone,
};

function renderIcon(icon: Spec): Raster {
  const raster = new Raster(ICON_SIZE, ICON_SIZE);
  PAINTERS[icon.shape](raster, icon);
  return raster;
}

function pasteIcon(sheet: Raster, icon: Raster, frame: number): void {
  const originX = (frame % COLUMNS) * ICON_SIZE;
  const originY = Math.floor(frame / COLUMNS) * ICON_SIZE;
  for (let y = 0; y < ICON_SIZE; y += 1) {
    for (let x = 0; x < ICON_SIZE; x += 1) {
      const from = (y * ICON_SIZE + x) * 4;
      const to = ((originY + y) * sheet.width + originX + x) * 4;
      sheet.data[to] = icon.data[from] ?? 0;
      sheet.data[to + 1] = icon.data[from + 1] ?? 0;
      sheet.data[to + 2] = icon.data[from + 2] ?? 0;
      sheet.data[to + 3] = icon.data[from + 3] ?? 0;
    }
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outputDirectory = join(root, 'content', 'assets', 'generated');
const manifestPath = join(root, 'content', 'assets', 'manifest.json');

const templateIds = Object.keys(BASE_CONTENT_BUNDLE.items).sort();
const missing = templateIds.filter((id) => ITEM_ICONS[id] === undefined);
if (missing.length > 0) {
  process.stderr.write(`missing item icons: ${missing.join(', ')}\n`);
  process.exit(1);
}

const kindOrder = ['weapon', 'armor', 'consumable', 'material'] as const;
const templates = Object.fromEntries(templateIds.map((id, index) => [id, index]));
const kinds = Object.fromEntries(
  kindOrder.map((kind, index) => [kind, templateIds.length + index]),
);
const fallback = templateIds.length + kindOrder.length;
const cellCount = fallback + 1;

if (cellCount > COLUMNS * ROWS) {
  process.stderr.write(
    `atlas needs ${String(cellCount)} cells but only has ${String(COLUMNS * ROWS)}\n`,
  );
  process.exit(1);
}

const sheet = new Raster(COLUMNS * ICON_SIZE, ROWS * ICON_SIZE);
for (const [id, frame] of Object.entries(templates)) {
  pasteIcon(sheet, renderIcon(ITEM_ICONS[id] as Spec), frame);
}
for (const kind of kindOrder) {
  pasteIcon(sheet, renderIcon(KIND_ICONS[kind]), kinds[kind] as number);
}
pasteIcon(sheet, renderIcon(FALLBACK_ICON), fallback);

mkdirSync(outputDirectory, { recursive: true });
const atlPath = join(outputDirectory, 'item_icons.png');
writeFileSync(atlPath, encodePng(sheet));
process.stdout.write(`wrote ${atlPath} (${String(templateIds.length)} item icons)\n`);

const expected = {
  style: 'procedural-placeholder' as const,
  image: 'item_icons.png',
  size: ICON_SIZE,
  columns: COLUMNS,
  rows: ROWS,
  templates,
  kinds,
  fallback,
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonical(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { itemIcons?: unknown };
if (canonical(manifest.itemIcons) !== canonical(expected)) {
  process.stderr.write(
    'manifest itemIcons is out of date; update content/assets/manifest.json to:\n' +
      `${JSON.stringify(expected, null, 2)}\n`,
  );
  process.exitCode = 1;
}
