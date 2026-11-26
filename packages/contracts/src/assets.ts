import { z } from 'zod';

/**
 * Asset manifest shared by the content compiler and the browser. It describes
 * placeholder technical art until the phase-8 art pass replaces the PNG files;
 * the structure stays the same when real tilesets arrive.
 */
export const assetTileSchema = z
  .object({
    gid: z.number().int().min(1),
    kind: z.enum(['ground', 'deco']),
    name: z.string().min(1).max(32),
    /** Base and accent colour used for raised terrain such as walls. */
    colors: z.tuple([z.number().int().min(0).max(0xffffff), z.number().int().min(0).max(0xffffff)]),
  })
  .strict();

export type AssetTile = z.infer<typeof assetTileSchema>;

export const assetTilesetSchema = z
  .object({
    id: z.string().min(1).max(32),
    image: z.string().min(1).max(200),
    tileWidth: z.number().int().min(8).max(256),
    tileHeight: z.number().int().min(8).max(256),
    columns: z.number().int().min(1).max(64),
    tileCount: z.number().int().min(1).max(1_024),
    tiles: z.array(assetTileSchema).min(1).max(1_024),
  })
  .strict()
  .superRefine((tileset, ctx) => {
    if (tileset.tiles.length !== tileset.tileCount) {
      ctx.addIssue({
        code: 'custom',
        path: ['tiles'],
        message: 'tiles must describe every tileset tile',
      });
    }
    tileset.tiles.forEach((tile, index) => {
      if (tile.gid !== index + 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['tiles', index, 'gid'],
          message: 'tile gids must be contiguous starting at 1',
        });
      }
    });
  });

export type AssetTileset = z.infer<typeof assetTilesetSchema>;

/**
 * Clips the browser can play for a character. Each clip lists column indices
 * into the character sheet; the sheet has one row per direction.
 */
export const characterClipSchema = z.enum(['idle', 'walk', 'attack', 'cast', 'hurt', 'death']);

export type CharacterClip = z.infer<typeof characterClipSchema>;

export const characterAnimationSchema = z
  .object({
    frames: z.array(z.number().int().min(0).max(15)).min(1).max(16),
    frameMs: z.number().int().min(40).max(2_000),
    loop: z.boolean(),
  })
  .strict();

export type CharacterAnimation = z.infer<typeof characterAnimationSchema>;

export const characterAnimationsSchema = z
  .object({
    idle: characterAnimationSchema.optional(),
    walk: characterAnimationSchema.optional(),
    attack: characterAnimationSchema.optional(),
    cast: characterAnimationSchema.optional(),
    hurt: characterAnimationSchema.optional(),
    death: characterAnimationSchema.optional(),
  })
  .strict();

export type CharacterAnimations = z.infer<typeof characterAnimationsSchema>;

export const assetCharacterSchema = z
  .object({
    id: z.string().min(1).max(32),
    image: z.string().min(1).max(200),
    frameWidth: z.number().int().min(8).max(256),
    frameHeight: z.number().int().min(8).max(256),
    directions: z.array(z.enum(['n', 'e', 's', 'w'])).length(4),
    frames: z.number().int().min(1).max(16),
    kind: z.literal('procedural-placeholder'),
    /** Optional clip table; sheets without one fall back to a 2-frame walk. */
    animations: characterAnimationsSchema.optional(),
  })
  .strict()
  .superRefine((character, ctx) => {
    if (character.animations === undefined) {
      return;
    }
    for (const [clip, animation] of Object.entries(character.animations)) {
      if (animation === undefined) {
        continue;
      }
      animation.frames.forEach((frame, index) => {
        if (frame >= character.frames) {
          ctx.addIssue({
            code: 'custom',
            path: ['animations', clip, 'frames', index],
            message: `clip "${clip}" frame ${String(frame)} exceeds the ${String(character.frames)}-column sheet`,
          });
        }
      });
      if (new Set(animation.frames).size !== animation.frames.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['animations', clip, 'frames'],
          message: `clip "${clip}" repeats a frame`,
        });
      }
    }
  });

export type AssetCharacter = z.infer<typeof assetCharacterSchema>;

export const assetMapEntrySchema = z
  .object({
    source: z.string().min(1),
    compiled: z.string().min(1),
  })
  .strict();

/**
 * Item icons live in one square-cell atlas shared by the bag, the equipment
 * slots and the merchant. Template ids map to explicit frames; content that
 * arrives without an icon falls back to its kind and then to `fallback`, so a
 * content release can never render an empty square.
 */
export const assetItemIconsSchema = z
  .object({
    image: z.string().min(1).max(200),
    /** Marks the atlas as generated placeholder art, not production icons. */
    style: z.literal('procedural-placeholder'),
    size: z.number().int().min(8).max(128),
    columns: z.number().int().min(1).max(64),
    rows: z.number().int().min(1).max(64),
    templates: z.record(z.string().min(1).max(64), z.number().int().min(0)),
    kinds: z
      .object({
        weapon: z.number().int().min(0),
        armor: z.number().int().min(0),
        consumable: z.number().int().min(0),
        material: z.number().int().min(0),
      })
      .strict(),
    fallback: z.number().int().min(0),
  })
  .strict()
  .superRefine((icons, ctx) => {
    const cells = icons.columns * icons.rows;
    const requireCell = (frame: number, path: (string | number)[]): void => {
      if (frame >= cells) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: `icon frame ${String(frame)} exceeds the ${String(cells)}-cell atlas`,
        });
      }
    };
    for (const [templateId, frame] of Object.entries(icons.templates)) {
      requireCell(frame, ['templates', templateId]);
    }
    for (const [kind, frame] of Object.entries(icons.kinds)) {
      requireCell(frame, ['kinds', kind]);
    }
    requireCell(icons.fallback, ['fallback']);
  });

export type AssetItemIcons = z.infer<typeof assetItemIconsSchema>;

export const assetManifestSchema = z
  .object({
    version: z.string().min(1).max(64),
    tilesets: z.record(z.string(), assetTilesetSchema),
    characters: z.record(z.string(), assetCharacterSchema),
    itemIcons: assetItemIconsSchema,
    maps: z.record(z.string(), assetMapEntrySchema),
  })
  .strict();

export type AssetManifest = z.infer<typeof assetManifestSchema>;
