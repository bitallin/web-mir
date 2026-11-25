import type { AccountView, CharacterView, CreateCharacterRequest } from '@web-legend/contracts';
import { useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  createCharacter as createCharacterRequest,
  fetchMe,
  loginAccount,
  logoutAccount,
  registerAccount,
  type Credentials,
} from '../api/client';
import { clearReconnectToken } from '../lib/identity';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export type AuthState = {
  status: AuthStatus;
  account: AccountView | null;
  characters: CharacterView[];
  error: string | null;
  pending: boolean;
};

const INITIAL_STATE: AuthState = {
  status: 'loading',
  account: null,
  characters: [],
  error: null,
  pending: false,
};

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return '网络错误，请检查连接后重试';
}

export type AuthControls = {
  state: AuthState;
  login: (credentials: Credentials) => Promise<boolean>;
  register: (credentials: Credentials) => Promise<boolean>;
  logout: () => Promise<void>;
  createCharacter: (input: CreateCharacterRequest) => Promise<CharacterView | null>;
  /** Re-reads /me so map, position and level are current after leaving a world. */
  refreshCharacters: () => Promise<void>;
  clearError: () => void;
};

export function useAuth(): AuthControls {
  const [state, setState] = useState<AuthState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetchMe();
        if (!cancelled) {
          setState({
            status: 'authenticated',
            account: response.account,
            characters: response.characters,
            error: null,
            pending: false,
          });
        }
      } catch {
        if (!cancelled) {
          setState({ ...INITIAL_STATE, status: 'anonymous' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const authenticate = useCallback(
    async (action: () => Promise<Awaited<ReturnType<typeof fetchMe>>>): Promise<boolean> => {
      setState((previous) => ({ ...previous, pending: true, error: null }));
      try {
        const response = await action();
        setState({
          status: 'authenticated',
          account: response.account,
          characters: response.characters,
          error: null,
          pending: false,
        });
        return true;
      } catch (error) {
        setState((previous) => ({
          ...previous,
          status: 'anonymous',
          account: null,
          characters: [],
          error: messageFor(error),
          pending: false,
        }));
        return false;
      }
    },
    [],
  );

  const login = useCallback(
    (credentials: Credentials) => authenticate(() => loginAccount(credentials)),
    [authenticate],
  );

  const register = useCallback(
    (credentials: Credentials) => authenticate(() => registerAccount(credentials)),
    [authenticate],
  );

  const logout = useCallback(async () => {
    setState((previous) => ({ ...previous, pending: true }));
    try {
      await logoutAccount();
    } catch {
      // The local session is cleared even if the server call failed.
    }
    clearReconnectToken();
    setState({ ...INITIAL_STATE, status: 'anonymous' });
  }, []);

  const createCharacter = useCallback(
    async (input: CreateCharacterRequest): Promise<CharacterView | null> => {
      setState((previous) => ({ ...previous, pending: true, error: null }));
      try {
        const response = await createCharacterRequest(input);
        setState((previous) => ({
          ...previous,
          characters: [...previous.characters, response.character],
          error: null,
          pending: false,
        }));
        return response.character;
      } catch (error) {
        setState((previous) => ({
          ...previous,
          error: messageFor(error),
          pending: false,
        }));
        return null;
      }
    },
    [],
  );

  const refreshCharacters = useCallback(async (): Promise<void> => {
    try {
      const response = await fetchMe();
      setState((previous) => ({
        ...previous,
        account: response.account,
        characters: response.characters,
      }));
    } catch {
      // Keep the last known list; entering a stale map fails in the server's
      // own validation and is reported to the player.
    }
  }, []);

  const clearError = useCallback(() => {
    setState((previous) => ({ ...previous, error: null }));
  }, []);

  return { state, login, register, logout, createCharacter, refreshCharacters, clearError };
}
