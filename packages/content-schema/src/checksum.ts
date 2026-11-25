import { createHash } from 'node:crypto';

import type { ContentBundle } from '@web-legend/contracts';

import { canonicalJson } from './canonical';

export function contentChecksum(bundle: ContentBundle): string {
  return createHash('sha256').update(canonicalJson(bundle), 'utf8').digest('hex');
}
