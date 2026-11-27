export type RoomPreference =
  { mode: 'joinOrCreate' } | { mode: 'create' } | { mode: 'joinById'; roomId: string };

/**
 * Development-only room selection used by the E2E suite so each scenario gets
 * an isolated room: `?fresh=1` creates a new room, `?join=<id>` joins one.
 * Identity no longer comes from query parameters; it always comes from a
 * server-issued game ticket.
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

/**
 * Development-only: `?freshTransfer=1` also creates a new room for each map
 * transfer. Automation that drives real combat needs a wilds room where no
 * other scenario is competing for the same spawns.
 */
export function loadFreshTransfers(search = window.location.search): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }
  return new URLSearchParams(search).get('freshTransfer') === '1';
}

const RECONNECT_STORAGE = 'web-legend.reconnect-token';

type StoredReconnect = {
  characterId: string;
  token: string;
};

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
    // Storage can be unavailable in hardened browsers; reconnection then
    // falls back to a fresh ticket.
  }
}

function parseStoredReconnect(raw: string | null): StoredReconnect | null {
  if (raw === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      'characterId' in value &&
      'token' in value &&
      typeof value.characterId === 'string' &&
      typeof value.token === 'string'
    ) {
      return { characterId: value.characterId, token: value.token };
    }
  } catch {
    // Legacy or corrupt value; treat as absent.
  }
  return null;
}

/**
 * Reconnection tokens are scoped to one character so signing out and selecting
 * another character can never reattach the browser to the previous one.
 */
export function readReconnectToken(characterId: string): string | null {
  const stored = parseStoredReconnect(readStorage(RECONNECT_STORAGE));
  if (stored === null) {
    return null;
  }
  if (stored.characterId !== characterId) {
    clearReconnectToken();
    return null;
  }
  return stored.token;
}

export function storeReconnectToken(characterId: string, token: string): void {
  writeStorage(RECONNECT_STORAGE, JSON.stringify({ characterId, token }));
}

export function clearReconnectToken(): void {
  try {
    window.sessionStorage.removeItem(RECONNECT_STORAGE);
  } catch {
    // Ignore unavailable storage.
  }
}
