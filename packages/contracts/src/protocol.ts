/**
 * The realtime protocol is versioned independently from application,
 * database, content and asset versions.
 */
export const PROTOCOL_VERSION = 1 as const;
export const MIN_SUPPORTED_PROTOCOL = 1 as const;

export const API_PREFIX = '/api/v1' as const;

export const SERVICE_NAMES = ['control-api', 'game-server'] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];
