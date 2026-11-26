import ruinedFieldsRaw from '../../../content/maps/compiled/ruined_fields.json';
import starterTownRaw from '../../../content/maps/compiled/starter_town.json';
import starterWildsRaw from '../../../content/maps/compiled/starter_wilds.json';

import {
  mapRuntimeManifestSchema,
  RUINED_FIELDS_MAP_ID,
  STARTER_TOWN_MAP_ID,
  STARTER_WILDS_MAP_ID,
  type MapRuntimeManifest,
} from './mapRuntime';

/**
 * Compiled runtime maps shared by the Control API (character spawn), the game
 * server (navigation and portals) and the browser (rendering). The JSON files
 * are generated from `content/maps/*.tmj` by `pnpm maps:compile`.
 */
export const STARTER_TOWN_MAP: MapRuntimeManifest = mapRuntimeManifestSchema.parse(starterTownRaw);
export const STARTER_WILDS_MAP: MapRuntimeManifest =
  mapRuntimeManifestSchema.parse(starterWildsRaw);
export const RUINED_FIELDS_MAP: MapRuntimeManifest =
  mapRuntimeManifestSchema.parse(ruinedFieldsRaw);

const MAPS_BY_ID: ReadonlyMap<string, MapRuntimeManifest> = new Map(
  [STARTER_TOWN_MAP, STARTER_WILDS_MAP, RUINED_FIELDS_MAP].map((map) => [map.mapId, map]),
);

export const MAP_MANIFESTS: readonly MapRuntimeManifest[] = [...MAPS_BY_ID.values()];

export function findMapManifest(mapId: string): MapRuntimeManifest | undefined {
  return MAPS_BY_ID.get(mapId);
}

export function requireMapManifest(mapId: string): MapRuntimeManifest {
  const map = findMapManifest(mapId);
  if (map === undefined) {
    throw new Error(`unknown map "${mapId}"`);
  }
  return map;
}

export { RUINED_FIELDS_MAP_ID, STARTER_TOWN_MAP_ID, STARTER_WILDS_MAP_ID };
