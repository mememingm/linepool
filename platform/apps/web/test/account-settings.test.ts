import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AccountView from '../src/views/AccountView.vue';
import { apiRequest } from '../src/services/api-client.js';
import { usePreferencesStore } from '../src/stores/preferences.js';

vi.mock('../src/services/api-client.js', () => ({
  ApiClientError: class ApiClientError extends Error {},
  apiRequest: vi.fn(),
}));

const requestMock = vi.mocked(apiRequest);

describe('AccountView settings', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    requestMock.mockReset();
    requestMock.mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000001',
      email: 'demo@linepool.local',
      displayName: 'LINEPOOL 演示用户',
      isDemo: true,
      createdAt: '2026-09-30T01:00:00.000Z',
    });
  });

  it('persists theme and language preferences through the settings controls', async () => {
    const wrapper = mount(AccountView, {
      global: {
        stubs: { RouterLink: true },
        mocks: { $router: { replace: vi.fn() } },
      },
    });
    await flushPromises();

    await wrapper.get('[data-testid="theme-dark"]').trigger('click');
    await wrapper.get('[data-testid="language-en"]').trigger('click');

    const preferences = usePreferencesStore();
    expect(preferences.theme).toBe('dark');
    expect(preferences.language).toBe('en');
    expect(localStorage.getItem('linepool.preferences')).toContain('dark');
  });

  it('keeps the password action inside the demo boundary without API key controls', async () => {
    const wrapper = mount(AccountView, {
      global: {
        stubs: { RouterLink: true },
        mocks: { $router: { replace: vi.fn() } },
      },
    });
    await flushPromises();

    await wrapper.get('[data-testid="password-current"]').setValue('demo-password');
    await wrapper.get('[data-testid="password-new"]').setValue('new-demo-password');
    await wrapper.get('[data-testid="password-confirm"]').setValue('new-demo-password');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="status"]').text()).toContain('演示密码已更新');
    expect(wrapper.text()).not.toContain('API Key');
    expect(wrapper.find('[data-testid="api-key-rotate"]').exists()).toBe(false);
    expect(localStorage.getItem('linepool.demo-api-key')).toBeNull();
  });
});
