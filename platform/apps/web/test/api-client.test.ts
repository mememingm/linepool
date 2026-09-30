import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError, apiRequest } from '../src/services/api-client.js';

describe('apiRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends cookies and returns the data payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { status: 'ok' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest<{ status: string }>('/health')).resolves.toEqual({
      status: 'ok',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('throws a typed API error using the server error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'AUTH_REQUIRED', message: '请先登录' },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const error = await apiRequest('/account').catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
      message: '请先登录',
    });
  });
});
