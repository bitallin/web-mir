import {
  API_PREFIX,
  apiErrorSchema,
  authResponseSchema,
  characterResponseSchema,
  gameTicketResponseSchema,
  type AuthResponse,
  type CharacterResponse,
  type CharacterView,
  type CreateCharacterRequest,
  type GameTicketResponse,
} from '@web-legend/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
  retryAfterRefresh?: boolean;
};

let refreshInFlight: Promise<boolean> | null = null;

async function rawRequest(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  return fetch(`${API_PREFIX}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

function parseError(response: Response, payload: unknown): ApiError {
  const parsed = apiErrorSchema.safeParse(payload);
  if (parsed.success) {
    return new ApiError(response.status, parsed.data.error.code, parsed.data.error.message);
  }
  return new ApiError(response.status, 'INTERNAL_ERROR', '请求失败，请稍后重试');
}

async function parseJson(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return null;
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight === null) {
    refreshInFlight = (async () => {
      const response = await rawRequest('/auth/refresh', { method: 'POST' });
      await parseJson(response);
      return response.ok;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * Same-origin JSON request with the HttpOnly session cookie. One 401 triggers
 * a refresh-token rotation and a single retry, so a tab idle past the access
 * token lifetime does not force a login.
 */
async function request(path: string, options: RequestOptions = {}): Promise<unknown> {
  const response = await rawRequest(path, options);
  const payload = await parseJson(response);

  if (response.ok) {
    return payload;
  }

  const error = parseError(response, payload);
  const canRetry =
    response.status === 401 && (options.retryAfterRefresh ?? true) && !path.startsWith('/auth/');
  if (canRetry && (await refreshSession())) {
    return request(path, { ...options, retryAfterRefresh: false });
  }
  throw error;
}

function parseAuthResponse(payload: unknown): AuthResponse {
  const parsed = authResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(500, 'INTERNAL_ERROR', '服务器返回了无法识别的账号数据');
  }
  return parsed.data;
}

export type Credentials = { username: string; password: string };

export async function registerAccount(credentials: Credentials): Promise<AuthResponse> {
  return parseAuthResponse(await request('/auth/register', { method: 'POST', body: credentials }));
}

export async function loginAccount(credentials: Credentials): Promise<AuthResponse> {
  return parseAuthResponse(await request('/auth/login', { method: 'POST', body: credentials }));
}

export async function logoutAccount(): Promise<void> {
  await request('/auth/logout', { method: 'POST', retryAfterRefresh: false });
}

export async function fetchMe(): Promise<AuthResponse> {
  return parseAuthResponse(await request('/me'));
}

export async function createCharacter(input: CreateCharacterRequest): Promise<CharacterResponse> {
  const payload = await request('/characters', { method: 'POST', body: input });
  const parsed = characterResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(500, 'INTERNAL_ERROR', '服务器返回了无法识别的角色数据');
  }
  return parsed.data;
}

export async function issueGameTicket(characterId: string): Promise<GameTicketResponse> {
  const payload = await request('/game/ticket', {
    method: 'POST',
    body: { characterId },
  });
  const parsed = gameTicketResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(500, 'INTERNAL_ERROR', '服务器返回了无法识别的票据数据');
  }
  return parsed.data;
}

export type { CharacterView };
