const BASE_URL = import.meta.env.VITE_API_URL || '/api';

function getToken(): string | null {
  return localStorage.getItem('api_token');
}

export function setToken(token: string): void {
  localStorage.setItem('api_token', token);
}

export function clearToken(): void {
  localStorage.removeItem('api_token');
}

export function hasToken(): boolean {
  return !!getToken();
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  if (res.headers.get('content-type')?.includes('application/json')) {
    return res.json();
  }

  return res as unknown as T;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  return api<T>(path);
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  return api<T>(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function apiPut<T = unknown>(path: string, body: unknown): Promise<T> {
  return api<T>(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  return api<T>(path, { method: 'DELETE' });
}

export async function apiDownload(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
