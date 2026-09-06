const API_BASE_URL = '/api/v1';
const ACCESS_TOKEN_KEY = 'zhishu-access-token-v1';

export interface ApiErrorBody {
  code?: string;
  message?: string;
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type SessionMode = 'operate' | 'report';

export interface AuthUser {
  id: string;
  email?: string;
  phone?: string;
  name?: string;
  role: string;
  tenantId: string;
  tenantName: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: AuthUser;
}

export interface AiSession {
  id: string;
  title: string;
  status: string;
  running: boolean;
  mode: SessionMode;
  categoryPrimary: string;
  categorySecondary: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUser {
  id: string;
  account: string;
  name?: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  sessionCount: number;
  lastLoginAt?: string;
  createdAt: string;
}

export interface CreateAdminUserInput {
  account: string;
  name: string;
  password: string;
}

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  dailyActiveUsers: number;
  totalSessions: number;
  todaySessions: number;
  totalTokens: number;
  todayTokens: number;
  inputTokens: number;
  outputTokens: number;
  artifactCount: number;
  todayArtifactCount: number;
  categories: Array<{ name: string; count: number }>;
  dailyTokens: Array<{ date: string; label: string; tokens: number; inputTokens: number; outputTokens: number }>;
  topCommands: Array<{ name: string; count: number }>;
  dailyActiveTrend: Array<{ date: string; label: string; count: number }>;
  dailySessionTrend: Array<{ date: string; label: string; count: number }>;
  topUsers: Array<{ userId: string; name: string; account: string; count: number }>;
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant' | string;
  content: string;
  status: string;
  createdAt: string;
  attachments: UploadedFile[];
  metrics?: {
    durationMs?: number;
    tokenCount: number;
    tokenEstimated: boolean;
    inputTokens?: number;
    outputTokens?: number;
    model?: string;
  };
}

export interface UploadedFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export type ArtifactKind = 'report' | 'workbook' | 'table' | 'chart' | 'other';

export interface Artifact {
  id: string;
  name: string;
  relativePath: string;
  mediaType: string;
  size: number;
  kind: ArtifactKind;
  createdAt: string;
}

/** 后端 exceljs → Univer 快照。直接喂给 univerAPI.createWorkbook。 */
export interface WorkbookSnapshot {
  id: string;
  name: string;
  sheetOrder: string[];
  sheets: Record<string, {
    id: string;
    name: string;
    rowCount: number;
    columnCount: number;
    cellData: Record<number, Record<number, { v: string | number | boolean; t: number }>>;
    mergeData: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }>;
    columnData?: Record<number, { w: number }>;
  }>;
  truncated: boolean;
}

export interface RuntimeEvent {
  type: string;
  sessionId: string;
  executionId: string | null;
  timestamp: number;
  data: Record<string, unknown>;
}

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.sessionStorage;
}

export function getAccessToken(): string | null {
  return storage()?.getItem(ACCESS_TOKEN_KEY) ?? null;
}

export function clearAccessToken(): void {
  storage()?.removeItem(ACCESS_TOKEN_KEY);
}

function saveAccessToken(token: string): void {
  storage()?.setItem(ACCESS_TOKEN_KEY, token);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('无法连接后端服务，请确认本地服务已经启动', 0, 'NETWORK_ERROR');
  }

  const body = await readBody(response);
  if (!response.ok) {
    const error = body && typeof body === 'object' ? body as ApiErrorBody : {};
    if (response.status === 401) {
      clearAccessToken();
      window.dispatchEvent(new Event('zhishu:auth-expired'));
    }
    throw new ApiError(
      error.message || `请求失败（HTTP ${response.status}）`,
      response.status,
      error.code,
      error.requestId,
    );
  }
  if (response.status === 204) return undefined as T;
  return body as T;
}

async function requestBlob(path: string): Promise<Blob> {
  const token = getAccessToken();
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    throw new ApiError('无法连接后端服务，请确认本地服务已经启动', 0, 'NETWORK_ERROR');
  }
  if (!response.ok) {
    if (response.status === 401) {
      clearAccessToken();
      window.dispatchEvent(new Event('zhishu:auth-expired'));
    }
    throw new ApiError(`请求失败（HTTP ${response.status}）`, response.status);
  }
  return response.blob();
}

export const api = {
  auth: {
    async login(account: string, password: string): Promise<LoginResponse> {
      const result = await request<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ account, password }),
      });
      saveAccessToken(result.accessToken);
      return result;
    },
    async register(name: string, phone: string, password: string): Promise<LoginResponse> {
      const result = await request<LoginResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, phone, password }),
      });
      saveAccessToken(result.accessToken);
      return result;
    },
    me: () => request<AuthUser>('/auth/me'),
    logout: clearAccessToken,
  },
  sessions: {
    list: () => request<AiSession[]>('/sessions'),
    get: (id: string) => request<AiSession>(`/sessions/${id}`),
    create: (title: string, mode?: SessionMode) => request<AiSession>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ title, ...(mode ? { mode } : {}) }),
    }),
    update: (id: string, patch: { title?: string; mode?: SessionMode }) => request<AiSession>(`/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
    remove: (id: string) => request<{ deleted: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),
  },
  messages: {
    list: (sessionId: string) => request<AiMessage[]>(`/sessions/${sessionId}/messages`),
    send: (
      sessionId: string,
      content: string,
      fileIds: string[] = [],
      mode?: SessionMode,
      context?: { file?: string; sheet?: string; selection?: string },
    ) =>
      request<{ executionId: string; status: 'accepted' }>(`/sessions/${sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content, fileIds, ...(mode ? { mode } : {}), ...(context ? { context } : {}) }),
      }),
    abort: (sessionId: string) =>
      request<{ status: 'aborted' | 'idle' }>(`/sessions/${sessionId}/abort`, { method: 'POST' }),
  },
  files: {
    listBySession: (sessionId: string) => request<UploadedFile[]>(`/files?sessionId=${encodeURIComponent(sessionId)}`),
    upload: (sessionId: string, file: File) => {
      const body = new FormData();
      body.set('sessionId', sessionId);
      body.set('file', file, file.name);
      return request<UploadedFile>('/files', { method: 'POST', body });
    },
    get: (id: string) => request<UploadedFile>(`/files/${id}`),
    workbook: (id: string) => request<WorkbookSnapshot>(`/files/${id}/workbook`),
    blob: (id: string) => requestBlob(`/files/${id}/original`),
    remove: (id: string) => request<{ deleted: boolean }>(`/files/${id}`, { method: 'DELETE' }),
  },
  artifacts: {
    list: (sessionId: string) => request<Artifact[]>(`/sessions/${sessionId}/artifacts`),
    workbook: (id: string) => request<WorkbookSnapshot>(`/artifacts/${id}/workbook`),
    blob: (id: string) => requestBlob(`/artifacts/${id}`),
  },
  admin: {
    users: () => request<AdminUser[]>('/admin/users'),
    createUser: (input: CreateAdminUserInput) => request<AdminUser>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    updateUserStatus: (id: string, status: 'active' | 'disabled') => request<AdminUser>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
    resetUserPassword: (id: string, newPassword: string) => request<{ reset: true }>(`/admin/users/${id}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ newPassword }),
    }),
    removeUser: (id: string) => request<{ deleted: true }>(`/admin/users/${id}`, { method: 'DELETE' }),
    stats: () => request<AdminStats>('/admin/stats'),
  },
};

export async function streamSessionEvents(
  sessionId: string,
  onEvent: (event: RuntimeEvent) => void,
  options: { signal: AbortSignal; onOpen?: () => void },
): Promise<void> {
  const token = getAccessToken();
  if (!token) throw new ApiError('登录已过期，请重新登录', 401, 'AUTH_ERROR');

  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/events`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    const body = await readBody(response);
    const error = body && typeof body === 'object' ? body as ApiErrorBody : {};
    throw new ApiError(error.message || '无法连接实时消息流', response.status, error.code, error.requestId);
  }

  options.onOpen?.();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try {
          onEvent(JSON.parse(line.slice(5).trim()) as RuntimeEvent);
        } catch {
          // Ignore a malformed event while keeping the stream alive.
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}
