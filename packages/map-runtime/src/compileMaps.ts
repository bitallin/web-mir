import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { assetManifestSchema } from '@web-legend/contracts';

import { compileMapSet, type MapSource } from './compile';

/**
 * Compiles every map declared in `content/assets/manifest.json` into the
 * immutable runtime format shared by the server and the browser. Run from the
 * repository root: `pnpm maps:compile`.
 */
function main(): void {
  const root = process.cwd();
  const manifestPath = resolve(root, 'content/assets/manifest.json');
  const manifest = assetManifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown,
  );

  const tileset = manifest.tilesets.terrain;
  if (tileset === undefined) {
    throw new Error('asset manifest has no "terrain" tileset');
  }

  const sources: MapSource[] = Object.values(manifest.maps).map((entry) => ({
    name: entry.source,
    data: JSON.parse(readFileSync(resolve(root, entry.source), 'utf8')) as unknown,
  }));

  const compiled = compileMapSet(sources, {
    tileset: {
      id: tileset.id,
      image: tileset.image,
      tileWidth: tileset.tileWidth,
      tileHeight: tileset.tileHeight,
      columns: tileset.columns,
      tileCount: tileset.tileCount,
    },
    assetManifestVersion: manifest.version,
  });

  for (const map of compiled) {
    const entry = manifest.maps[map.mapId];
    if (entry === undefined) {
      throw new Error(`compiled map "${map.mapId}" is not declared in the asset manifest`);
    }
    const outputPath = resolve(root, entry.compiled);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(map, null, 2)}\n`);
    process.stdout.write(
      `compiled ${map.mapId}: ${String(map.width)}x${String(map.height)}, ` +
        `sha256 ${map.checksum.slice(0, 12)}… -> ${entry.compiled}\n`,
    );
  }
}

main();
