interface ApiClientOptions {
  getToken: () => string;
  onUnauthorized: () => void;
  onMutationError: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorMessage(data: unknown, status: number): string {
  if (isRecord(data)) {
    if (typeof data.detail === 'string') return data.detail;
    if (Array.isArray(data.detail)) {
      const messages = data.detail.flatMap(item => isRecord(item) && typeof item.msg === 'string' ? [item.msg] : []);
      if (messages.length) return messages.join('; ');
    }
    if (typeof data.error === 'string') return data.error;
  }
  return `Ошибка сервера: ${status}`;
}

export function createApiClient({ getToken, onUnauthorized, onMutationError }: ApiClientOptions) {
  return async function apiFetch<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T | null> {
    // All API traffic stays same-origin, including credentials from the session.
    if (!endpoint.startsWith('/') || endpoint.startsWith('//')) throw new Error('Неверный путь API');
    const headers = new Headers(options.headers);
    if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    try {
      const response = await fetch('/api/v1' + endpoint, { ...options, headers });
      if (response.status === 401) {
        onUnauthorized();
        throw new Error('Требуется авторизация (401)');
      }
      if (response.status === 204) return null;
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(data, response.status));
      return data as T;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error('Не удалось связаться с сервером');
      if (options.method && options.method.toUpperCase() !== 'GET' && endpoint !== '/documents/recognize') {
        onMutationError(error);
      }
      throw error;
    }
  };
}
