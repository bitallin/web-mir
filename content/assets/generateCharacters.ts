/**
 * Regenerates the three class character sheets under `generated/`.
 *
 * These are deliberately simple procedural placeholders, not production art:
 * each class gets a distinct silhouette and palette so players can tell them
 * apart, plus idle/walk/attack/cast/hurt/death frames. The frame layout is
 * fixed by the asset manifest: one row per direction (n, e, s, w) and one
 * column per frame index.
 *
 * Run with `pnpm assets:generate`. Output is deterministic, so a clean tree
 * reproduces the committed PNGs byte for byte.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodePng, Raster, rgb, type Rgba } from './raster';

const FRAME_WIDTH = 32;
const FRAME_HEIGHT = 48;
const FRAME_COLUMNS = 10;
const DIRECTIONS = ['n', 'e', 's', 'w'] as const;

type Direction = (typeof DIRECTIONS)[number];
type ClassId = 'warrior' | 'mage' | 'taoist';
type Clip = 'idle' | 'walk' | 'attack' | 'cast' | 'hurt' | 'death';

const CLIP_FRAMES: Record<Clip, number[]> = {
  idle: [0],
  walk: [1, 2],
  attack: [3, 4],
  cast: [5, 6],
  hurt: [7],
  death: [8, 9],
};

type Palette = {
  skin: Rgba;
  skinShade: Rgba;
  hair: Rgba;
  accent: Rgba;
  trim: Rgba;
  body: Rgba;
  bodyShade: Rgba;
  legs: Rgba;
  boots: Rgba;
  weapon: Rgba;
  weaponAccent: Rgba;
  glow: Rgba;
};

const PALETTES: Record<ClassId, Palette> = {
  warrior: {
    skin: rgb(0xe6b78f),
    skinShade: rgb(0xc99873),
    hair: rgb(0x5d3b28),
    accent: rgb(0x9aa3ad),
    trim: rgb(0xd8b45a),
    body: rgb(0x9e3b32),
    bodyShade: rgb(0x742a24),
    legs: rgb(0x3c3f46),
    boots: rgb(0x26272c),
    weapon: rgb(0xc8ccd4),
    weaponAccent: rgb(0x8b6b3d),
    glow: rgb(0xff9a6b),
  },
  mage: {
    skin: rgb(0xeacbb0),
    skinShade: rgb(0xcda684),
    hair: rgb(0xd9d4c4),
    accent: rgb(0xe0c060),
    trim: rgb(0xe0c060),
    body: rgb(0x415ea8),
    bodyShade: rgb(0x2f4680),
    legs: rgb(0x2f4680),
    boots: rgb(0x27355f),
    weapon: rgb(0x7a5a3a),
    weaponAccent: rgb(0x86d7ff),
    glow: rgb(0x9fd8ff),
  },
  taoist: {
    skin: rgb(0xe8c49d),
    skinShade: rgb(0xc9a077),
    hair: rgb(0x2b2b2b),
    accent: rgb(0xd8d0b0),
    trim: rgb(0xd8c98a),
    body: rgb(0x3f7a55),
    bodyShade: rgb(0x2c5a3e),
    legs: rgb(0x2c5a3e),
    boots: rgb(0x203c2b),
    weapon: rgb(0xb8955c),
    weaponAccent: rgb(0xf2e6b8),
    glow: rgb(0xc9f0b0),
  },
};

type Pose = {
  clip: Clip;
  /** Vertical body offset: positive values crouch, negative values rise. */
  bob: number;
  /** Side-view stride: front leg lands this many pixels ahead. */
  stride: number;
  /** Front-view swing: alternate leg lifts by one pixel. */
  step: number;
  /** 0 = arms down, 1 = arms raised, 2 = weapon thrust. */
  arms: 0 | 1 | 2;
  /** The weapon is drawn towards the facing side instead of resting. */
  swing: boolean;
};

function poseFor(clip: Clip, frame: number): Pose {
  switch (clip) {
    case 'walk':
      return {
        clip,
        bob: 0,
        stride: frame === 0 ? 2 : -2,
        step: frame === 0 ? 1 : -1,
        arms: 0,
        swing: false,
      };
    case 'attack':
      return {
        clip,
        bob: frame === 0 ? 1 : -1,
        stride: 1,
        step: 0,
        arms: frame === 0 ? 1 : 2,
        swing: frame === 1,
      };
    case 'cast':
      return { clip, bob: -1, stride: 0, step: 0, arms: frame === 0 ? 1 : 2, swing: false };
    case 'hurt':
      return { clip, bob: 1, stride: 0, step: 0, arms: 1, swing: false };
    case 'death':
      return { clip, bob: 4 + frame * 2, stride: 0, step: 0, arms: 1, swing: false };
    case 'idle':
    default:
      return { clip, bob: 0, stride: 0, step: 0, arms: 0, swing: false };
  }
}

function drawLegs(raster: Raster, palette: Palette, direction: Direction, pose: Pose): void {
  const lifted = pose.step;
  if (direction === 'e' || direction === 'w') {
    const frontX = 15 + pose.stride;
    const backX = 13 - pose.stride;
    raster.rect(frontX, 33, 4, 13, palette.legs);
    raster.rect(backX, 33, 4, 13, palette.bodyShade);
    raster.rect(frontX - 1, 45, 6, 2, palette.boots);
    raster.rect(backX - 1, 45, 6, 2, palette.boots);
    return;
  }
  const leftLift = Math.max(0, lifted);
  const rightLift = Math.max(0, -lifted);
  raster.rect(11, 33, 4, 13 - leftLift, palette.legs);
  raster.rect(18, 33, 4, 13 - rightLift, palette.legs);
  raster.rect(10, 45 - leftLift, 6, 2, palette.boots);
  raster.rect(17, 45 - rightLift, 6, 2, palette.boots);
}

function drawRobeHem(raster: Raster, palette: Palette, color: Rgba): void {
  raster.rect(9, 30, 15, 12, color);
  raster.rect(8, 41, 17, 3, palette.bodyShade);
  for (let x = 9; x < 24; x += 3) {
    raster.rect(x, 44, 2, 1, palette.trim);
  }
}

function drawWeapon(
  raster: Raster,
  palette: Palette,
  classId: ClassId,
  direction: Direction,
  pose: Pose,
): void {
  const front = direction === 'e' || direction === 's';
  const handX = front ? 23 : 8;
  if (classId === 'warrior') {
    if (pose.swing) {
      raster.line(handX, 22, handX + (front ? 7 : -7), 12, palette.weapon);
      raster.line(handX, 23, handX + (front ? 7 : -7), 13, palette.weaponAccent);
      return;
    }
    const tipY = pose.arms === 1 ? 4 : 26;
    const tipX = handX + (front ? 2 : -2);
    raster.line(handX, 24, tipX, tipY, palette.weapon);
    raster.line(handX, 26, handX, 30, palette.weaponAccent);
    return;
  }
  // Mage and taoist carry a staff with a glowing head.
  const topY = pose.arms === 1 ? 2 : pose.clip === 'cast' ? 10 : 6;
  const topX = handX + (front ? 1 : -1);
  raster.line(handX, 30, topX, topY + 3, palette.weapon);
  raster.ellipse(topX, topY - 1, 2, 2, palette.weaponAccent);
  if (pose.clip === 'cast') {
    raster.ellipse(topX + (front ? 3 : -3), topY + 1, 1, 1, palette.glow);
  }
}

function drawHead(
  raster: Raster,
  palette: Palette,
  classId: ClassId,
  direction: Direction,
  pose: Pose,
): void {
  const y = 8 + pose.bob;
  const lean = direction === 'e' ? 1 : direction === 'w' ? -1 : 0;

  if (direction === 'n') {
    raster.rect(12, y, 9, 11, palette.hair);
    raster.rect(13, y + 8, 7, 3, palette.skinShade);
  } else if (direction === 'e' || direction === 'w') {
    raster.rect(13 + lean, y, 8, 11, palette.skin);
    raster.rect(12 + lean, y, 4, 10, palette.hair);
    raster.rect(13 + lean, y + 9, 7, 2, palette.skinShade);
    raster.pixel(18 + lean, y + 4, palette.hair);
  } else {
    raster.rect(12, y, 9, 11, palette.skin);
    raster.rect(12, y - 2, 9, 4, palette.hair);
    raster.rect(11, y + 1, 2, 7, palette.hair);
    raster.rect(20, y + 1, 2, 7, palette.hair);
    raster.pixel(14, y + 5, palette.hair);
    raster.pixel(18, y + 5, palette.hair);
    raster.rect(15, y + 8, 3, 1, palette.skinShade);
  }

  if (classId === 'warrior') {
    // Steel helm with a nose guard and a short crest.
    raster.rect(10, y - 3, 13, 4, palette.accent);
    raster.rect(10, y - 1, 2, 9, palette.accent);
    raster.rect(21, y - 1, 2, 9, palette.accent);
    raster.rect(16, y + 1, 1, 5, palette.trim);
    raster.rect(15, y - 5, 3, 2, palette.trim);
  } else if (classId === 'mage') {
    // Tall pointed hat.
    raster.rect(9, y - 3, 15, 3, palette.body);
    raster.rect(11, y - 7, 11, 4, palette.body);
    raster.rect(14, y - 10, 5, 3, palette.bodyShade);
    raster.rect(12, y - 2, 9, 1, palette.trim);
  } else {
    // Topknot and headband.
    raster.rect(13, y - 3, 7, 2, palette.hair);
    raster.rect(15, y - 6, 3, 3, palette.hair);
    raster.rect(11, y + 1, 11, 1, palette.accent);
    raster.rect(20, y + 6, 3, 5, palette.weaponAccent);
  }
}

function drawArms(
  raster: Raster,
  palette: Palette,
  classId: ClassId,
  direction: Direction,
  pose: Pose,
): void {
  const y = 18 + pose.bob;
  const robe = classId !== 'warrior';
  const sleeve: Rgba = robe ? palette.body : palette.accent;

  if (direction === 'e' || direction === 'w') {
    const frontX = 20;
    if (pose.arms === 2) {
      raster.rect(frontX, y + 2, 5, 3, sleeve);
      raster.rect(frontX + 4, y + 2, 2, 3, palette.skin);
      raster.rect(11, y, 3, 9, sleeve);
      raster.rect(11, y + 8, 3, 2, palette.skin);
    } else if (pose.arms === 1) {
      raster.rect(frontX - 1, y - 3, 4, 8, sleeve);
      raster.rect(frontX - 1, y - 5, 4, 2, palette.skin);
      raster.rect(11, y + 2, 3, 8, sleeve);
      raster.rect(11, y + 9, 3, 2, palette.skin);
    } else {
      raster.rect(frontX - 2, y + 1, 3, 9, sleeve);
      raster.rect(frontX - 2, y + 9, 3, 2, palette.skin);
      raster.rect(11, y + 1, 3, 9, sleeve);
      raster.rect(11, y + 9, 3, 2, palette.skin);
    }
    return;
  }

  if (pose.arms === 2) {
    raster.rect(9, y + 2, 4, 9, sleeve);
    raster.rect(20, y + 2, 4, 9, sleeve);
    raster.rect(9, y + 10, 4, 2, palette.skin);
    raster.rect(20, y + 10, 4, 2, palette.skin);
    return;
  }
  if (pose.arms === 1) {
    raster.rect(6, y - 3, 4, 9, sleeve);
    raster.rect(22, y - 3, 4, 9, sleeve);
    raster.rect(6, y - 5, 4, 2, palette.skin);
    raster.rect(22, y - 5, 4, 2, palette.skin);
    return;
  }
  raster.rect(7, y + 1, 3, 9, sleeve);
  raster.rect(22, y + 1, 3, 9, sleeve);
  raster.rect(7, y + 9, 3, 2, palette.skin);
  raster.rect(22, y + 9, 3, 2, palette.skin);
}

function drawTorso(
  raster: Raster,
  palette: Palette,
  classId: ClassId,
  direction: Direction,
  pose: Pose,
): void {
  const y = 18 + pose.bob;
  if (direction === 'e' || direction === 'w') {
    raster.rect(12, y, 8, 15, palette.body);
    raster.rect(12, y, 3, 15, palette.bodyShade);
    raster.rect(12, y + 4, 8, 2, palette.trim);
    if (classId === 'warrior') {
      raster.rect(18, y - 1, 3, 4, palette.accent);
    }
    return;
  }

  raster.rect(10, y, 13, 15, palette.body);
  raster.rect(10, y, 3, 15, palette.bodyShade);
  raster.rect(10, y + 5, 13, 2, palette.trim);
  if (classId === 'warrior') {
    // Pauldrons.
    raster.rect(9, y - 1, 4, 4, palette.accent);
    raster.rect(20, y - 1, 4, 4, palette.accent);
    raster.rect(23, y + 1, 1, 6, palette.trim);
  } else if (classId === 'taoist') {
    raster.rect(15, y + 2, 3, 4, palette.weaponAccent);
  } else {
    raster.rect(15, y + 2, 3, 3, palette.trim);
  }
}

function drawDeath(raster: Raster, palette: Palette, classId: ClassId, frame: number): void {
  if (frame === 0) {
    // Knees buckle: a crouched silhouette.
    raster.rect(12, 30, 9, 12, palette.body);
    raster.rect(11, 41, 12, 3, palette.bodyShade);
    raster.rect(13, 18, 8, 9, palette.skin);
    raster.rect(13, 16, 8, 3, palette.hair);
    raster.rect(9, 30, 3, 8, palette.bodyShade);
    raster.rect(21, 30, 3, 8, palette.bodyShade);
    return;
  }
  // Down: a lying silhouette anchored to the ground.
  raster.rect(6, 40, 16, 6, palette.body);
  raster.rect(6, 44, 16, 2, palette.bodyShade);
  raster.rect(21, 38, 7, 7, palette.skin);
  raster.rect(21, 37, 7, 3, classId === 'mage' ? palette.body : palette.hair);
  raster.rect(2, 41, 5, 4, palette.legs);
  raster.rect(2, 44, 5, 2, palette.boots);
  raster.rect(12, 38, 8, 2, palette.trim);
}

function drawCharacter(classId: ClassId, direction: Direction, clip: Clip, frame: number): Raster {
  const palette = PALETTES[classId];
  const pose = poseFor(clip, frame);
  const raster = new Raster(FRAME_WIDTH, FRAME_HEIGHT);

  if (clip === 'death') {
    drawDeath(raster, palette, classId, frame);
    return raster;
  }

  drawLegs(raster, palette, direction, pose);
  if (classId !== 'warrior') {
    drawRobeHem(raster, palette, palette.body);
  }
  drawTorso(raster, palette, classId, direction, pose);
  drawArms(raster, palette, classId, direction, pose);
  drawHead(raster, palette, classId, direction, pose);
  drawWeapon(raster, palette, classId, direction, pose);
  return raster;
}

function clipForFrame(frame: number): Clip {
  for (const [clip, frames] of Object.entries(CLIP_FRAMES)) {
    if (frames.includes(frame)) {
      return clip as Clip;
    }
  }
  throw new Error(`no clip owns frame ${String(frame)}`);
}

function renderSheet(classId: ClassId): Raster {
  const sheet = new Raster(FRAME_WIDTH * FRAME_COLUMNS, FRAME_HEIGHT * DIRECTIONS.length);
  DIRECTIONS.forEach((direction, row) => {
    for (let frame = 0; frame < FRAME_COLUMNS; frame += 1) {
      const clip = clipForFrame(frame);
      const source =
        direction === 'w'
          ? mirrored(drawCharacter(classId, 'e', clip, frame))
          : drawCharacter(classId, direction, clip, frame);
      for (let y = 0; y < FRAME_HEIGHT; y += 1) {
        for (let x = 0; x < FRAME_WIDTH; x += 1) {
          const from = (y * FRAME_WIDTH + x) * 4;
          const to =
            ((row * FRAME_HEIGHT + y) * FRAME_WIDTH * FRAME_COLUMNS + frame * FRAME_WIDTH + x) * 4;
          sheet.data[to] = source.data[from] ?? 0;
          sheet.data[to + 1] = source.data[from + 1] ?? 0;
          sheet.data[to + 2] = source.data[from + 2] ?? 0;
          sheet.data[to + 3] = source.data[from + 3] ?? 0;
        }
      }
    }
  });
  return sheet;
}

function mirrored(source: Raster): Raster {
  const target = new Raster(source.width, source.height);
  target.mirrorFrom(source);
  return target;
}

const outputDirectory = join(dirname(fileURLToPath(import.meta.url)), 'generated');
mkdirSync(outputDirectory, { recursive: true });

for (const classId of ['warrior', 'mage', 'taoist'] as const) {
  const file = join(outputDirectory, `class_${classId}.png`);
  writeFileSync(file, encodePng(renderSheet(classId)));
  process.stdout.write(`wrote ${file}\n`);
}
