import rawTestMap from '../../../content/maps/phase1_test_map.json';

import { mapManifestSchema, type MapManifest } from './map';

/**
 * Canonical phase-1 technical map shared by the Control API (character spawn)
 * and the game server (authoritative simulation). Phase 3 replaces it with a
 * compiled map-runtime manifest. Exported on a subpath so the admin bundle
 * does not include map data.
 */
export const PHASE1_TEST_MAP: MapManifest = mapManifestSchema.parse(rawTestMap);
