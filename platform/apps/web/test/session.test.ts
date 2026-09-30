import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '../src/stores/session.js';

describe('session store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restores an unauthenticated session only once per app startup', async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          error: { code: 'AUTH_REQUIRED', message: '请先登录' },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const session = useSessionStore();
    await session.restore();
    await session.restore();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(session.isAuthenticated).toBe(false);
  });
});
