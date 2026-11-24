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

export const assetCharacterSchema = z
  .object({
    id: z.string().min(1).max(32),
    image: z.string().min(1).max(200),
    frameWidth: z.number().int().min(8).max(256),
    frameHeight: z.number().int().min(8).max(256),
    directions: z.array(z.enum(['n', 'e', 's', 'w'])).length(4),
    frames: z.number().int().min(1).max(16),
    kind: z.literal('procedural-placeholder'),
  })
  .strict();

export type AssetCharacter = z.infer<typeof assetCharacterSchema>;

export const assetMapEntrySchema = z
  .object({
    source: z.string().min(1),
    compiled: z.string().min(1),
  })
  .strict();

export const assetManifestSchema = z
  .object({
    version: z.string().min(1).max(64),
    tilesets: z.record(z.string(), assetTilesetSchema),
    characters: z.record(z.string(), assetCharacterSchema),
    maps: z.record(z.string(), assetMapEntrySchema),
  })
  .strict();

export type AssetManifest = z.infer<typeof assetManifestSchema>;
