'use client';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface ApiErrorPayload {
  code: string;
  category: string;
  httpStatus: number;
  retryable: boolean;
  userMessage: string;
  remediation?: { action: string; url?: string };
  correlationId: string;
  details?: unknown;
  context?: Record<string, unknown>;
}

/**
 * Carries the server's catalogued error straight to the UI. The API already
 * produced a localized, actionable message and a correlation id — inventing a
 * generic client-side message on top of that would throw away both.
 */
export class ApiError extends Error {
  constructor(readonly payload: ApiErrorPayload) {
    super(payload.userMessage);
    this.name = 'ApiError';
  }

  get code(): string {
    return this.payload.code;
  }

  get correlationId(): string {
    return this.payload.correlationId;
  }
}

let currentWorkspaceId: string | null = null;
let currentLocale = 'pt-BR';

export function setWorkspaceId(id: string | null): void {
  currentWorkspaceId = id;
  if (typeof window !== 'undefined') {
    if (id) window.localStorage.setItem('dmflow.workspace', id);
    else window.localStorage.removeItem('dmflow.workspace');
  }
}

export function getStoredWorkspaceId(): string | null {
  if (currentWorkspaceId) return currentWorkspaceId;
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('dmflow.workspace');
}

export function setLocale(locale: string): void {
  currentLocale = locale;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; workspaceId?: string | null } = {},
): Promise<T> {
  const workspaceId = options.workspaceId ?? getStoredWorkspaceId();

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-dmflow-locale': currentLocale,
  };
  if (workspaceId) headers['x-dmflow-workspace'] = workspaceId;

  const response = await fetch(API_URL + path, {
    method: options.method ?? 'GET',
    headers,
    // Session lives in an httpOnly cookie, so every call must carry credentials.
    credentials: 'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (data?.error) throw new ApiError(data.error as ApiErrorPayload);
    throw new ApiError({
      code: 'NETWORK_ERROR',
      category: 'INTERNAL',
      httpStatus: response.status,
      retryable: true,
      userMessage:
        currentLocale === 'en'
          ? 'We could not reach the server. Check your connection and try again.'
          : 'Não conseguimos falar com o servidor. Verifique sua conexão e tente de novo.',
      correlationId: response.headers.get('x-correlation-id') ?? 'unknown',
    });
  }

  return data as T;
}

export const get = <T>(path: string, workspaceId?: string | null) =>
  api<T>(path, { workspaceId });
export const post = <T>(path: string, body?: unknown, workspaceId?: string | null) =>
  api<T>(path, { method: 'POST', body, workspaceId });
export const put = <T>(path: string, body?: unknown, workspaceId?: string | null) =>
  api<T>(path, { method: 'PUT', body, workspaceId });
export const patch = <T>(path: string, body?: unknown, workspaceId?: string | null) =>
  api<T>(path, { method: 'PATCH', body, workspaceId });
export const del = <T>(path: string, workspaceId?: string | null) =>
  api<T>(path, { method: 'DELETE', workspaceId });
