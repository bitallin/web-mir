import { worldRoomNameFor, type MapRuntimeManifest } from '@web-legend/contracts';
import { MAP_MANIFESTS } from '@web-legend/contracts/maps';
import { createMapRuntime, type MapRuntime } from '@web-legend/map-runtime';

/**
 * One Map Template has exactly one fixed Map Instance in the MVP (ADR-018).
 * The instance id is stored on public state so a later line/multi-instance
 * rollout can add `starter_town-2` without changing the protocol.
 */
export const MAP_INSTANCE_ID = '1' as const;

export type MapInstance = {
  instanceId: string;
  mapId: string;
  roomName: string;
  runtime: MapRuntime;
};

export function createMapInstance(manifest: MapRuntimeManifest): MapInstance {
  return {
    instanceId: MAP_INSTANCE_ID,
    mapId: manifest.mapId,
    roomName: worldRoomNameFor(manifest.mapId),
    runtime: createMapRuntime(manifest),
  };
}

export function createMapInstances(
  manifests: readonly MapRuntimeManifest[] = MAP_MANIFESTS,
): MapInstance[] {
  return manifests.map((manifest) => createMapInstance(manifest));
}

export function findMapInstance(instances: readonly MapInstance[], mapId: string): MapInstance {
  const instance = instances.find((candidate) => candidate.mapId === mapId);
  if (instance === undefined) {
    throw new Error(`no map instance is configured for "${mapId}"`);
  }
  return instance;
}
