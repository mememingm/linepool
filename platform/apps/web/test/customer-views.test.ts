import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

    const wrapper = mount(OrdersView);
    await flushPromises();

    expect(paginatedMock).toHaveBeenCalledWith('/orders?page=1&pageSize=10');
    expect(wrapper.text()).toContain('LP-DEMO-0001');
    expect(wrapper.text()).toContain('美国验证码');
    expect(wrapper.text()).toContain('1,200');
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
    paginatedMock.mockResolvedValue({
      data: [message],
      pagination: {
        page: 1,
        pageSize: 10,
        totalItems: 1,
        totalPages: 1,
      },
    });
    requestMock.mockResolvedValue({ ...message, isRead: true });

    const wrapper = mount(InboxView);
    await flushPromises();
    await wrapper.get('[data-testid="mark-read"]').trigger('click');
    await flushPromises();

    expect(requestMock).toHaveBeenCalledWith(
      `/inbox/${message.id}/read`,
      { method: 'POST' },
    );
    expect(wrapper.text()).toContain('已读');
    expect(wrapper.find('[data-testid="mark-read"]').exists()).toBe(false);
  });

  it('filters purchased numbers by their effective status', async () => {
    const pagination = {
      page: 1,
      pageSize: 10,
      totalItems: 1,
      totalPages: 1,
    };
    paginatedMock
      .mockResolvedValueOnce({
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
        pagination,
      })
      .mockResolvedValueOnce({ data: [], pagination });

    const wrapper = mount(NumbersView);
    await flushPromises();
    await wrapper.get('[data-testid="status-expired"]').trigger('click');
    await flushPromises();

    expect(paginatedMock).toHaveBeenNthCalledWith(
      1,
      '/numbers?page=1&pageSize=10',
    );
    expect(paginatedMock).toHaveBeenNthCalledWith(
      2,
      '/numbers?page=1&pageSize=10&status=EXPIRED',
    );
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

    const wrapper = mount(PointsView);
    await flushPromises();

    expect(envelopeMock).toHaveBeenCalledWith('/points?page=1&pageSize=10');
    expect(wrapper.text()).toContain('16,400');
    expect(wrapper.text()).toContain('购买 2 个演示号码');
  });
});
