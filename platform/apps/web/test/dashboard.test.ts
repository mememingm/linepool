import type { Dashboard } from '@linepool/contracts';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '../src/services/api-client.js';
import { useSessionStore } from '../src/stores/session.js';
import DashboardView from '../src/views/DashboardView.vue';

vi.mock('../src/services/api-client.js', () => ({
  ApiClientError: class ApiClientError extends Error {},
  apiRequest: vi.fn(),
}));

const requestMock = vi.mocked(apiRequest);

describe('DashboardView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    requestMock.mockReset();
  });

  it('groups the primary action with the greeting and presents points beside it', async () => {
    const dashboard: Dashboard = {
      pointsBalance: 16_400,
      availableProjects: [],
      recentOrders: [],
    };
    requestMock.mockResolvedValue(dashboard);

    const session = useSessionStore();
    session.user = {
      id: '10000000-0000-4000-8000-000000000001',
      email: 'demo@linepool.local',
      displayName: 'LINEPOOL 演示用户',
      isDemo: true,
      pointsBalance: dashboard.pointsBalance,
      createdAt: '2026-09-30T01:00:00.000Z',
    };
    const push = vi.fn();

    const wrapper = mount(DashboardView, {
      global: {
        mocks: { $router: { push } },
        stubs: { RouterLink: RouterLinkStub },
      },
    });
    await flushPromises();

    const hero = wrapper.get('[data-testid="dashboard-hero"]');
    const intro = hero.get('.dashboard-intro');
    expect(intro.get('h1').text()).toBe('你好，LINEPOOL 演示用户');
    expect(intro.get('.dashboard-summary-copy').text()).toBe('这里是你的号码服务摘要。');

    const browseButton = intro.get('button');
    expect(browseButton.text()).toContain('浏览项目');
    await browseButton.trigger('click');
    expect(push).toHaveBeenCalledWith({ name: 'projects' });

    const pointsSummary = hero.get('aside[aria-label="积分摘要"]');
    expect(pointsSummary.text()).toContain('可用积分');
    expect(pointsSummary.text()).toContain('16,400');
    expect(wrapper.text()).not.toContain('所有购买均为本地 mock 流程，不发生真实支付。');
  });
});
