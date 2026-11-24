import { createHash } from 'node:crypto';

import type { MapRuntimeManifest } from '@web-legend/contracts';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

export type ManifestFingerprint = Omit<MapRuntimeManifest, 'checksum'>;

/**
 * Deterministic digest of every runtime-relevant map field. Content tooling and
 * the server compare this value; it is not a security signature.
 */
export function mapChecksum(fingerprint: ManifestFingerprint): string {
  return createHash('sha256').update(stableStringify(fingerprint)).digest('hex');
}

export function verifyManifestChecksum(manifest: MapRuntimeManifest): boolean {
  const { checksum, ...fingerprint } = manifest;
  return mapChecksum(fingerprint) === checksum;
}
