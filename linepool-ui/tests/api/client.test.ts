import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLinepoolApi } from '../../src/linepool/api/client';

const id = '00000000-0000-4000-8000-000000000001';
const user = { id, email: 'member@example.invalid', displayName: 'Member', isDemo: false, pointsBalance: 100, createdAt: '2026-01-01T00:00:00.000Z', role: 'USER' };
const intent = { region: 'us' as const, service: 'Telegram' as const, plan: 'month' as const, quantity: 1, idempotencyKey: id };
const order = {
  id, orderNumber: 'LP-TEST', region: 'us', country: 'United States', service: 'Telegram', plan: 'month', planName: '30 days',
  quantity: 1, unitPoints: 15, totalPoints: 15, durationDays: 30, status: 'COMPLETED', createdAt: user.createdAt, isDemo: true, numbers: [],
};
const fetchMock = vi.fn<typeof fetch>();
const reply = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
const api = () => createLinepoolApi({ baseUrl: 'http://api.example.invalid/api/', timeoutMs: 1000 });

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('request and response contracts', () => {
  it('sends normalized login/register bodies with cookie credentials and no cache', async () => {
    fetchMock.mockResolvedValue(reply({ data: user }));
    await api().login({ email: ' MEMBER@EXAMPLE.INVALID ', password: 'valid-password' });
    expect(fetchMock).toHaveBeenCalledWith('http://api.example.invalid/api/auth/login', expect.objectContaining({
      method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'valid-password' }),
    }));
    fetchMock.mockResolvedValue(reply({ data: user }));
    await api().register({ email: user.email, password: 'valid-password', displayName: ' Member ' });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string)).toEqual({ email: user.email, password: 'valid-password', displayName: 'Member' });
  });

  it('rejects invalid input before fetch, and malformed or non-JSON success responses', async () => {
    expect(() => api().order('not-a-uuid')).toThrow();
    expect(() => api().createOrder({ ...intent, quantity: 0 })).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(reply({ data: { ...user, pointsBalance: -1 } })).mockResolvedValueOnce(new Response('not JSON'));
    await expect(api().me()).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
    await expect(api().me()).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
  });

  it.each([401, 403, 404, 409, 429, 500, 503])('retains structured HTTP %s errors and details', async status => {
    fetchMock.mockResolvedValue(reply({ error: { code: 'EXPECTED', message: 'Expected failure', details: { reason: 'fixture' } } }, status));
    await expect(api().me()).rejects.toMatchObject({ name: 'LinepoolApiError', status, code: 'EXPECTED', details: { reason: 'fixture' } });
  });

  it('checks admin access through the guarded endpoint and preserves permission failures', async () => {
    fetchMock.mockResolvedValueOnce(reply({ data: { ...user, role: 'ADMIN' } }));
    await expect(api().adminSession()).resolves.toMatchObject({ data: { role: 'ADMIN' } });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.example.invalid/api/admin/session');
    fetchMock.mockResolvedValueOnce(reply({ error: { code: 'ADMIN_REQUIRED', message: 'Platform administrator access is required' } }, 403));
    await expect(api().adminSession()).rejects.toMatchObject({ status: 403, code: 'ADMIN_REQUIRED' });
  });

  it('does not mistake malformed HTTP errors for success or network errors', async () => {
    fetchMock.mockResolvedValue(new Response('upstream unavailable', { status: 502 }));
    await expect(api().me()).rejects.toMatchObject({ status: 502, code: 'HTTP_ERROR', message: 'HTTP 502' });
  });

  it('encodes filters and keeps false/unread values and pagination defaults', async () => {
    fetchMock.mockResolvedValue(reply({ data: [], pagination: { page: 2, pageSize: 20, totalItems: 0, totalPages: 0 } }));
    await api().inbox({ page: 2, search: 'A & B', unread: 'false', numberId: id });
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get('search')).toBe('A & B');
    expect(url.searchParams.get('unread')).toBe('false');
    expect(url.searchParams.get('numberId')).toBe(id);
    expect(url.searchParams.get('pageSize')).toBe('20');
  });

  it('retains the same idempotency key after a lost order response and never retries implicitly', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('lost response')).mockResolvedValueOnce(reply({ data: order }));
    const client = api();
    await expect(client.createOrder(intent)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(client.createOrder(intent)).resolves.toEqual({ data: order });
    expect(fetchMock.mock.calls.map(call => JSON.parse(call[1]!.body as string).idempotencyKey)).toEqual([id, id]);
  });

  it('sends explicit logout, read and preference mutation shapes without inventing data', async () => {
    const client = api();
    fetchMock.mockResolvedValueOnce(reply({ data: { loggedOut: true } }));
    await expect(client.logout()).resolves.toEqual({ data: { loggedOut: true } });
    expect(fetchMock.mock.calls.at(-1)![1]!.body).toBe('{}');
    fetchMock.mockResolvedValueOnce(reply({ data: { ids: [id], isRead: true } }));
    await client.markRead([id]);
    expect(fetchMock.mock.calls.at(-1)![0]).toMatch(/\/inbox\/read$/);
    fetchMock.mockResolvedValueOnce(reply({ data: { expiryNotice: false, language: 'zh-CN' } }));
    await client.preferences(false);
    expect(fetchMock.mock.calls.at(-1)![1]).toMatchObject({ method: 'PATCH', body: '{"expiryNotice":false}' });
  });
});

describe('abort and timeout behavior', () => {
  it('maps fetch failure without exposing its raw message', async () => {
    fetchMock.mockRejectedValue(new TypeError('private transport detail'));
    await expect(api().me()).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the API' });
  });

  it('maps its timeout to REQUEST_TIMEOUT and cleans the timer', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    const result = expect(api().me()).rejects.toMatchObject({ status: 0, code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves caller cancellation instead of relabeling it as timeout', async () => {
    const controller = new AbortController();
    const reason = new DOMException('Caller cancelled', 'AbortError');
    fetchMock.mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    const request = api().me({ signal: controller.signal });
    const result = expect(request).rejects.toBe(reason);
    controller.abort(reason);
    await result;
  });

  it('relays a signal that was aborted before the request began', async () => {
    const controller = new AbortController();
    const reason = new DOMException('Already cancelled', 'AbortError');
    controller.abort(reason);
    fetchMock.mockImplementation((_url, init) => Promise.reject(init!.signal!.reason));
    await expect(api().me({ signal: controller.signal })).rejects.toBe(reason);
  });
});
