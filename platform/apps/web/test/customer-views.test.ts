import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import InboxView from '../src/views/InboxView.vue';
import NumbersView from '../src/views/NumbersView.vue';
import OrdersView from '../src/views/OrdersView.vue';
import PointsView from '../src/views/PointsView.vue';
import {
  apiEnvelopeRequest,
  apiPaginatedRequest,
  apiRequest,
} from '../src/services/api-client.js';

vi.mock('../src/services/api-client.js', () => ({
  ApiClientError: class ApiClientError extends Error {},
  apiEnvelopeRequest: vi.fn(),
  apiPaginatedRequest: vi.fn(),
  apiRequest: vi.fn(),
}));

const paginatedMock = vi.mocked(apiPaginatedRequest);
const envelopeMock = vi.mocked(apiEnvelopeRequest);
const requestMock = vi.mocked(apiRequest);

describe('customer activity views', () => {
  beforeEach(() => {
    paginatedMock.mockReset();
    envelopeMock.mockReset();
    requestMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads and renders persisted orders from the API', async () => {
    paginatedMock.mockResolvedValue({
      data: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          orderNumber: 'LP-DEMO-0001',
          project: {
            id: '20000000-0000-4000-8000-000000000001',
            name: '美国验证码',
          },
          plan: {
            id: '30000000-0000-4000-8000-000000000001',
            name: '标准验证包',
          },
          quantity: 1,
          totalPoints: 1200,
          status: 'COMPLETED',
          createdAt: '2026-09-30T01:00:00.000Z',
        },
      ],
      pagination: {
        page: 1,
        pageSize: 10,
        totalItems: 1,
        totalPages: 1,
      },
    });

    const wrapper = mount(OrdersView, {
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    await flushPromises();

    expect(paginatedMock).toHaveBeenCalledWith('/orders?page=1&pageSize=10');
    expect(wrapper.text()).toContain('LP-DEMO-0001');
    expect(wrapper.text()).toContain('美国验证码');
    expect(wrapper.text()).toContain('1,200');
    expect(wrapper.getComponent(RouterLinkStub).props('to')).toEqual({
      name: 'order-detail',
      params: { id: '10000000-0000-4000-8000-000000000001' },
    });
  });

  it('marks an owned inbox message as read without reloading the page', async () => {
    const message = {
      id: '70000000-0000-4000-8000-000000000001',
      phoneNumberId: '50000000-0000-4000-8000-000000000001',
      phoneNumber: '+15550001001',
      sender: 'LINEPOOL Demo',
      body: '您的演示验证码是 482913。',
      verificationCode: '482913',
      receivedAt: '2026-09-30T01:00:00.000Z',
      isRead: false,
    };
    const pagination = {
      page: 1,
      pageSize: 100,
      totalItems: 1,
      totalPages: 1,
    };
    paginatedMock.mockImplementation(async (path) => {
      if (path.startsWith('/inbox')) return { data: [message], pagination };
      return {
        data: [{
          id: message.phoneNumberId,
          phoneNumber: message.phoneNumber,
          project: {
            id: '20000000-0000-4000-8000-000000000001',
            name: '美国验证码',
          },
          orderId: '10000000-0000-4000-8000-000000000001',
          status: 'ACTIVE',
          assignedAt: '2026-09-29T01:00:00.000Z',
          expiresAt: '2026-10-01T01:00:00.000Z',
        }],
        pagination,
      };
    });
    requestMock.mockResolvedValue({ ...message, isRead: true });

    const wrapper = mount(InboxView);
    await flushPromises();
    expect(wrapper.text()).not.toContain('历史记录');
    await wrapper.get('[data-testid="mark-read"]').trigger('click');
    await flushPromises();

    expect(requestMock).toHaveBeenCalledWith(
      `/inbox/${message.id}/read`,
      { method: 'POST' },
    );
    expect(wrapper.text()).toContain('已读');
    expect(wrapper.find('[data-testid="mark-read"]').exists()).toBe(false);
  });

  it('refreshes manually and automatically and marks the filtered inbox read', async () => {
    vi.useFakeTimers();
    const messages = [
      {
        id: '70000000-0000-4000-8000-000000000001',
        phoneNumberId: '50000000-0000-4000-8000-000000000001',
        phoneNumber: '+15550001001',
        sender: 'LINEPOOL Demo',
        body: '验证码 482913',
        verificationCode: '482913',
        receivedAt: new Date().toISOString(),
        isRead: false,
      },
      {
        id: '70000000-0000-4000-8000-000000000002',
        phoneNumberId: '50000000-0000-4000-8000-000000000001',
        phoneNumber: '+15550001001',
        sender: 'Sample Service',
        body: '欢迎使用演示号码',
        verificationCode: null,
        receivedAt: new Date().toISOString(),
        isRead: false,
      },
    ];
    const pagination = {
      page: 1,
      pageSize: 100,
      totalItems: messages.length,
      totalPages: 1,
    };
    paginatedMock.mockImplementation(async (path) => path.startsWith('/inbox')
      ? { data: messages, pagination }
      : {
          data: [{
            id: '50000000-0000-4000-8000-000000000001',
            phoneNumber: '+15550001001',
            project: {
              id: '20000000-0000-4000-8000-000000000001',
              name: '美国验证码',
            },
            orderId: '10000000-0000-4000-8000-000000000001',
            status: 'ACTIVE',
            assignedAt: '2026-09-29T01:00:00.000Z',
            expiresAt: '2026-10-01T01:00:00.000Z',
          }],
          pagination: { ...pagination, totalItems: 1 },
        });
    requestMock.mockImplementation(async (path) => ({
      ...messages.find((message) => path.includes(message.id))!,
      isRead: true,
    }));

    const wrapper = mount(InboxView);
    await flushPromises();

    await wrapper.get('[data-testid="refresh-inbox"]').trigger('click');
    await flushPromises();
    expect(paginatedMock.mock.calls.filter(([path]) => path.startsWith('/inbox'))).toHaveLength(2);

    await wrapper.get('[data-testid="auto-refresh"]').setValue(true);
    await vi.advanceTimersByTimeAsync(30_000);
    await flushPromises();
    expect(paginatedMock.mock.calls.filter(([path]) => path.startsWith('/inbox'))).toHaveLength(3);

    await wrapper.get('[data-testid="mark-all-read"]').trigger('click');
    await flushPromises();
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('[data-testid="mark-read"]')).toHaveLength(0);
  });

  it('filters purchased numbers by search, project, plan, and backend status', async () => {
    const now = Date.now();
    const pagination = {
      page: 1,
      pageSize: 100,
      totalItems: 1,
      totalPages: 1,
    };
    paginatedMock.mockImplementation(async (path) => {
      if (path.startsWith('/numbers')) return {
        data: [{
          id: '50000000-0000-4000-8000-000000000001',
          phoneNumber: '+15550001001',
          project: {
            id: '20000000-0000-4000-8000-000000000001',
            name: '美国验证码',
          },
          orderId: '10000000-0000-4000-8000-000000000001',
          status: 'ACTIVE',
          assignedAt: new Date(now - 60 * 60 * 1000).toISOString(),
          expiresAt: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(),
        }],
        pagination,
      };
      if (path.startsWith('/orders')) return {
        data: [{
          id: '10000000-0000-4000-8000-000000000001',
          orderNumber: 'LP-DEMO-0001',
          project: {
            id: '20000000-0000-4000-8000-000000000001',
            name: '美国验证码',
          },
          plan: {
            id: '30000000-0000-4000-8000-000000000001',
            name: '标准验证包',
          },
          quantity: 1,
          totalPoints: 1200,
          status: 'COMPLETED',
          createdAt: new Date(now - 60 * 60 * 1000).toISOString(),
        }],
        pagination,
      };
      return {
        data: [{
          id: '20000000-0000-4000-8000-000000000001',
          slug: 'us-verification',
          name: '美国验证码',
          countryCode: 'US',
          countryName: '美国',
          description: '演示项目',
          accentColor: '#246bfd',
          isActive: true,
          availableCount: 3,
          minPoints: 1200,
        }],
        pagination,
      };
    });

    const wrapper = mount(NumbersView, {
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    await flushPromises();

    expect(paginatedMock).toHaveBeenCalledWith('/numbers?page=1&pageSize=100');
    expect(paginatedMock).toHaveBeenCalledWith('/orders?page=1&pageSize=100');
    expect(paginatedMock).toHaveBeenCalledWith('/projects?page=1&pageSize=100');
    expect(wrapper.text()).toContain('标准验证包');
    expect(wrapper.text()).not.toContain('即将到期');
    expect(wrapper.text()).not.toContain('收码中');

    await wrapper.get('[data-testid="status-active"]').trigger('click');
    expect(wrapper.get('[data-testid="status-active"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).toContain('+15550001001');

    await wrapper.get('[data-testid="random-number"]').trigger('click');
    expect(wrapper.get('[data-testid="random-result"]').text()).toContain('演示随机结果');
  });

  it('renders the backend balance and point ledger together', async () => {
    envelopeMock.mockResolvedValue({
      data: {
        balance: 16400,
        entries: [{
          id: '60000000-0000-4000-8000-000000000003',
          type: 'ORDER_DEBIT',
          delta: -2400,
          balanceAfter: 16400,
          description: '购买 2 个演示号码',
          referenceId: '10000000-0000-4000-8000-000000000001',
          createdAt: '2026-09-30T01:00:00.000Z',
        }],
      },
      pagination: {
        page: 1,
        pageSize: 10,
        totalItems: 1,
        totalPages: 1,
      },
    });

    const wrapper = mount(PointsView, {
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    await flushPromises();

    expect(envelopeMock).toHaveBeenCalledWith('/points?page=1&pageSize=10');
    expect(wrapper.text()).toContain('16,400');
    expect(wrapper.text()).toContain('购买 2 个演示号码');
    expect(wrapper.getComponent(RouterLinkStub).props('to')).toEqual({
      name: 'order-detail',
      params: { id: '10000000-0000-4000-8000-000000000001' },
    });
  });
});
