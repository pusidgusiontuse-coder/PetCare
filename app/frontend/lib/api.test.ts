import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './api';

afterEach(() => { vi.unstubAllGlobals(); });

function client() {
  const onUnauthorized = vi.fn();
  const onMutationError = vi.fn();
  const request = createApiClient({ getToken: () => 'session-token', onUnauthorized, onMutationError });
  return { request, onUnauthorized, onMutationError };
}

describe('same-origin authenticated API', () => {
  it('preserves caller headers and sends the session token', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: 42 }));
    vi.stubGlobal('fetch', fetch);
    const result = await client().request<{ id: number }>('/pets', { headers: new Headers({ 'X-Test': 'yes' }) });
    expect(result).toEqual({ id: 42 });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/pets');
    expect(options.headers.get('Authorization')).toBe('Bearer session-token');
    expect(options.headers.get('X-Test')).toBe('yes');
  });

  it('handles a successful deletion with no response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(await client().request('/pets/1', { method: 'DELETE' })).toBeNull();
  });

  it('revokes an invalid session and propagates failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status: 401 })));
    const { request, onUnauthorized } = client();
    await expect(request('/auth/me')).rejects.toThrow('Требуется авторизация');
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('reports validation errors and requests recovery after a failed mutation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail: [{ msg: 'Неверная дата' }] }, { status: 422 })));
    const { request, onMutationError } = client();
    await expect(request('/pets/1', { method: 'PUT', body: '{}' })).rejects.toThrow('Неверная дата');
    expect(onMutationError).toHaveBeenCalledOnce();
  });

  it('does not set JSON content type for file uploads', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ text: 'Карта' }));
    vi.stubGlobal('fetch', fetch);
    await client().request('/documents/recognize', { method: 'POST', body: new FormData() });
    expect(fetch.mock.calls[0][1].headers.has('Content-Type')).toBe(false);
  });

  it('does not send a token to an external destination', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(client().request('https://example.com/pets')).rejects.toThrow('Неверный путь API');
    await expect(client().request('//example.com/pets')).rejects.toThrow('Неверный путь API');
    expect(fetch).not.toHaveBeenCalled();
  });
});
