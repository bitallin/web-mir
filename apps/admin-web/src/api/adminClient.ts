import {
  API_PREFIX,
  adminAuthResponseSchema,
  adminCommandsResponseSchema,
  adminContentActivateResponseSchema,
  adminContentDraftDetailSchema,
  adminContentPublishResponseSchema,
  adminContentReleasesResponseSchema,
  adminContentStateSchema,
  adminDashboardSchema,
  adminPlayerDetailSchema,
  adminPlayersResponseSchema,
  adminActionResultSchema,
  adminAuditResponseSchema,
  adminRoomsResponseSchema,
  apiErrorSchema,
  contentValidationReportSchema,
  type AdminAuthResponse,
  type AdminCommandsQuery,
  type AdminCommandsResponse,
  type AdminContentActivateResponse,
  type AdminContentDraftDetail,
  type AdminContentPublishResponse,
  type AdminContentReleasesResponse,
  type AdminContentState,
  type AdminDashboard,
  type AdminPlayerDetail,
  type AdminPlayerListQuery,
  type AdminPlayersResponse,
  type AdminActionResult,
  type AdminAuditQuery,
  type AdminAuditResponse,
  type AdminRoomsResponse,
  type ContentSection,
  type ContentValidationReport,
} from '@web-legend/contracts';
const ADMIN_PREFIX = `${API_PREFIX}/admin`;

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

type ResponseParser<T> = {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false };
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
};

async function request<T>(
  path: string,
  schema: ResponseParser<T>,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(`${ADMIN_PREFIX}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) {
      throw new AdminApiError(
        response.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.details ?? [],
      );
    }
    throw new AdminApiError(response.status, 'INTERNAL_ERROR', '请求失败，请稍后重试');
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AdminApiError(500, 'INTERNAL_ERROR', '服务器返回了无法识别的数据');
  }
  return parsed.data;
}

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && `${value}`.length > 0) {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text.length === 0 ? '' : `?${text}`;
}

export const adminApi = {
  login(username: string, password: string): Promise<AdminAuthResponse> {
    return request('/auth/login', adminAuthResponseSchema, {
      method: 'POST',
      body: { username, password },
    });
  },

  me(): Promise<AdminAuthResponse> {
    return request('/auth/me', adminAuthResponseSchema);
  },

  async logout(): Promise<void> {
    await fetch(`${ADMIN_PREFIX}/auth/logout`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
  },

  dashboard(): Promise<AdminDashboard> {
    return request('/dashboard', adminDashboardSchema);
  },

  players(params: Partial<AdminPlayerListQuery>): Promise<AdminPlayersResponse> {
    return request(`/players${queryString({ ...params })}`, adminPlayersResponseSchema);
  },

  player(characterId: string): Promise<AdminPlayerDetail> {
    return request(`/players/${characterId}`, adminPlayerDetailSchema);
  },

  rooms(): Promise<AdminRoomsResponse> {
    return request('/rooms', adminRoomsResponseSchema);
  },

  audit(params: Partial<AdminAuditQuery>): Promise<AdminAuditResponse> {
    return request(`/audit-logs${queryString({ ...params })}`, adminAuditResponseSchema);
  },

  commands(params: Partial<AdminCommandsQuery>): Promise<AdminCommandsResponse> {
    return request(`/commands${queryString({ ...params })}`, adminCommandsResponseSchema);
  },

  kick(characterId: string, reason: string): Promise<AdminActionResult> {
    return request(`/players/${characterId}/actions/kick`, adminActionResultSchema, {
      method: 'POST',
      body: { reason },
    });
  },

  ban(characterId: string, reason: string): Promise<AdminActionResult> {
    return request(`/players/${characterId}/actions/ban`, adminActionResultSchema, {
      method: 'POST',
      body: { reason },
    });
  },

  mute(characterId: string, reason: string, durationSeconds: number): Promise<AdminActionResult> {
    return request(`/players/${characterId}/actions/mute`, adminActionResultSchema, {
      method: 'POST',
      body: { reason, durationSeconds },
    });
  },

  contentState(): Promise<AdminContentState> {
    return request('/content/state', adminContentStateSchema);
  },

  contentDraft(section: ContentSection): Promise<AdminContentDraftDetail> {
    return request(`/content/drafts/${section}`, adminContentDraftDetailSchema);
  },

  saveDraft(
    section: ContentSection,
    payload: Record<string, unknown>,
    reason: string,
  ): Promise<AdminContentDraftDetail> {
    return request(`/content/drafts/${section}`, adminContentDraftDetailSchema, {
      method: 'PUT',
      body: { section, payload, reason },
    });
  },

  validateContent(): Promise<ContentValidationReport> {
    return request('/content/validate', contentValidationReportSchema, {
      method: 'POST',
      body: {},
    });
  },

  publishContent(reason: string, note?: string): Promise<AdminContentPublishResponse> {
    return request('/content/releases', adminContentPublishResponseSchema, {
      method: 'POST',
      body: { reason, ...(note === undefined ? {} : { note }) },
    });
  },

  releases(): Promise<AdminContentReleasesResponse> {
    return request('/content/releases', adminContentReleasesResponseSchema);
  },

  activateContent(releaseId: string, reason: string): Promise<AdminContentActivateResponse> {
    return request('/content/activate', adminContentActivateResponseSchema, {
      method: 'POST',
      body: { releaseId, reason },
    });
  },
};
