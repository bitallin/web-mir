import { worldJoinOptionsSchema } from '@web-legend/contracts';

const PLAYER_KEY_STORAGE = 'web-legend.dev.player-key';
const DISPLAY_NAME_STORAGE = 'web-legend.dev.display-name';
const RECONNECT_TOKEN_STORAGE = 'web-legend.reconnect-token';

const displayNameSchema = worldJoinOptionsSchema.shape.displayName;
const playerKeySchema = worldJoinOptionsSchema.shape.playerKey;

export type DevIdentity = {
  playerKey: string;
  displayName: string;
};

export type RoomPreference =
  { mode: 'joinOrCreate' } | { mode: 'create' } | { mode: 'joinById'; roomId: string };

/**
 * Development-only room selection used by the E2E suite so each scenario gets
 * an isolated room: `?fresh=1` creates a new room, `?join=<id>` joins one.
 */
export function loadRoomPreference(search = window.location.search): RoomPreference {
  if (!import.meta.env.DEV) {
    return { mode: 'joinOrCreate' };
  }
  const params = new URLSearchParams(search);
  if (params.get('fresh') === '1') {
    return { mode: 'create' };
  }
  const joinId = params.get('join')?.trim();
  if (joinId !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(joinId)) {
    return { mode: 'joinById', roomId: joinId };
  }
  return { mode: 'joinOrCreate' };
}

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in hardened browsers; identity stays per page.
  }
}

function validName(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = displayNameSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function validKey(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = playerKeySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Temporary development identity (ADR-015). In development the `name` and
 * `key` query parameters let two browser contexts pick deterministic names;
 * otherwise a per-tab key and display name live in sessionStorage so a page
 * refresh keeps the same player.
 */
export function loadDevIdentity(search = window.location.search): DevIdentity {
  const params = new URLSearchParams(search);
  const allowOverrides = import.meta.env.DEV;

  const queryName = allowOverrides ? validName(params.get('name')?.trim()) : null;
  const queryKey = allowOverrides ? validKey(params.get('key')?.trim()) : null;

  const storedKey = validKey(readStorage(PLAYER_KEY_STORAGE));
  const playerKey = queryKey ?? storedKey ?? crypto.randomUUID();
  writeStorage(PLAYER_KEY_STORAGE, playerKey);

  const storedName = validName(readStorage(DISPLAY_NAME_STORAGE));
  const displayName =
    queryName ?? storedName ?? `游侠${String(Math.floor(Math.random() * 9_000) + 1_000)}`;
  writeStorage(DISPLAY_NAME_STORAGE, displayName);

  return { playerKey, displayName };
}

export function readReconnectToken(): string | null {
  return readStorage(RECONNECT_TOKEN_STORAGE);
}

export function storeReconnectToken(token: string): void {
  writeStorage(RECONNECT_TOKEN_STORAGE, token);
}

export function clearReconnectToken(): void {
  try {
    window.sessionStorage.removeItem(RECONNECT_TOKEN_STORAGE);
  } catch {
    // Ignore unavailable storage.
  }
}
