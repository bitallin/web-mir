import { mapManifestSchema, type MapManifest } from '@web-legend/contracts';

import rawTestMap from '../../../../content/maps/phase1_test_map.json';

/**
 * Phase 1 technical map, loaded from the same JSON the browser bundles. It is
 * replaced by a compiled MapRuntimeManifest from `map-runtime` in phase 3.
 */
export const PHASE1_TEST_MAP: MapManifest = mapManifestSchema.parse(rawTestMap);
