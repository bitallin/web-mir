import { mapManifestSchema, type MapManifest } from '@web-legend/contracts';

import rawTestMap from '../../../../content/maps/phase1_test_map.json';

/**
 * Phase 1 technical map. It is a real map manifest shared with the server, but
 * its visuals are placeholders until the Tiled pipeline lands in phase 3.
 */
export const TECHNICAL_MAP: MapManifest = mapManifestSchema.parse(rawTestMap);
