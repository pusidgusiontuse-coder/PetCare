import { language, uiText } from '../i18n';
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
    if (typeof data.detail === 'string') return uiText(data.detail);
    if (isRecord(data.detail) && typeof data.detail.message === 'string') {
      if (language === 'en' && data.detail.reason === 'account_cooldown' && typeof data.detail.retry_after === 'number') {
        return `Too many failed sign-in attempts. Try again in ${data.detail.retry_after} seconds.`;
      }
      return uiText(data.detail.message);
    }
    if (Array.isArray(data.detail)) {
      const messages = data.detail.flatMap(item => isRecord(item) && typeof item.msg === 'string' ? [uiText(item.msg)] : []);
      if (messages.length) return messages.join('; ');
    }
    if (typeof data.error === 'string') return uiText(data.error);
  }
  return status === 401 ? uiText("Требуется авторизация (401)") : `${uiText("Ошибка сервера:")+" "}${status}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly support: string;
  constructor(status: number, data: unknown) {
    super(errorMessage(data, status));
    this.status = status;
    const detail = isRecord(data) ? data.detail : null;
    this.support = isRecord(detail) && typeof detail.support_contact === 'string' ? detail.support_contact : '';
  }
}

export function createApiClient({ getToken, onUnauthorized, onMutationError }: ApiClientOptions) {
  return async function apiFetch<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T | null> {
    // All API traffic stays same-origin, including credentials from the session.
    if (!endpoint.startsWith('/') || endpoint.startsWith('//')) throw new Error(uiText("Неверный путь API"));
    const headers = new Headers(options.headers);
    headers.set('X-PetCare-Language', language);
    if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    try {
      const response = await fetch('/api/v1' + endpoint, { ...options, headers });
      if (response.status === 204) return null;
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 && endpoint !== '/auth/login') onUnauthorized();
      if (!response.ok) throw new ApiError(response.status, data);
      return data as T;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(uiText("Не удалось связаться с сервером"));
      if (options.method && options.method.toUpperCase() !== 'GET' && endpoint !== '/documents/recognize') {
        onMutationError(error);
      }
      throw error;
    }
  };
}
