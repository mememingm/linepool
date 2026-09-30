import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { router } from '../src/router.js';

describe('router session recovery', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the login route when session restoration is rate limited', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    )));

    await router.push('/orders');
    await router.isReady();

    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query).toMatchObject({
      redirect: '/orders',
      sessionError: 'rate-limited',
    });
  });
});
